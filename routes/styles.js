// Save as: routes/styles.js
const express = require('express');
const path = require('path');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const fileStorage = require('../lib/storage');

const router = express.Router();

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error(`Unsupported image type: ${file.mimetype}`));
  },
});

// The operation sheet photo is only ever forwarded to Gemini for extraction —
// it isn't a saved asset like the style photo, so memory storage is enough.
const uploadSheet = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error(`Unsupported image type: ${file.mimetype}`));
  },
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('select * from styles order by created_at desc');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { brand, style_name, garment_type, line_number, cloned_from_style_id } = req.body;
  try {
    const result = await pool.query(
      `insert into styles (brand, style_name, garment_type, line_number, cloned_from_style_id, created_by)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [brand || null, style_name, garment_type, line_number || null, cloned_from_style_id || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// STYLE PHOTO — a single reference photo of the garment, attached while
// building the operation list. Accepts either a file picked from disk or
// a still frame captured live from the camera (same "photo" field either
// way). Replaces any previous photo for this style.
// ------------------------------------------------------------
router.post('/:id/photo', requireAuth, uploadPhoto.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'photo file is required' });

  try {
    const existing = await pool.query('select photo_url from styles where id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Style not found' });

    const photo_url = await fileStorage.uploadBuffer(req.file.buffer, 'style-photos', req.file.originalname, req.file.mimetype);

    const result = await pool.query(
      `update styles set photo_url = $1, updated_at = now() where id = $2 returning *`,
      [photo_url, req.params.id]
    );

    await fileStorage.deleteFile(existing.rows[0].photo_url);

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// EXTRACT OPERATIONS FROM A PHOTO — reads a photographed operation
// bulletin / line-balancing sheet and returns an ordered list of
// operation descriptions, each cross-referenced against this style's
// garment-type library for a possible existing match. Nothing is
// written to the database here — this is preview-only; the frontend
// reuses the normal element/operation creation endpoints once the
// supervisor reviews and confirms each row.
// ------------------------------------------------------------
router.post('/:id/extract-operations', requireAuth, uploadSheet.single('sheet'), async (req, res) => {
  if (!genAI) return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server' });
  if (!req.file) return res.status(400).json({ error: 'sheet image is required' });

  try {
    const styleResult = await pool.query('select garment_type from styles where id = $1', [req.params.id]);
    if (!styleResult.rows[0]) return res.status(404).json({ error: 'Style not found' });
    const garmentType = styleResult.rows[0].garment_type;

    const libraryResult = await pool.query(
      `select id, name, category, video_url, is_placeholder from elements
       where is_active = true and scope = 'permanent' and $1 = any(garment_types)`,
      [garmentType]
    );
    const nameToElement = new Map(libraryResult.rows.map((r) => [r.name.toLowerCase(), r]));
    const libraryNames = libraryResult.rows.map((r) => r.name);

    // Google's free-tier model lineup shifts often (older names can drop to
    // zero quota or disappear entirely) — override via GEMINI_MODEL in .env
    // if this one ever stops working, no code change needed.
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `You are reading a photo of a garment factory operation bulletin / line-balancing sheet.

Extract ONLY the operation descriptions, in the sequence order they are listed (usually numbered "SI No" or similar, read top to bottom, and left column group before right column group if the sheet has multiple side-by-side sections). Ignore all other columns such as operator names, SMV, target/hour, and grade. Skip section header rows that are not actual sewing operations (e.g. "1ST PREP SECTION", "2ND PREP SECTION", "ASSEMBLY SECTION" are section labels, not operations — skip them).

Factory shorthand you may see: T/S = topstitch, SLV = sleeve, PLKT = placket, R/S = right side, KAAJ = buttonhole, TRUN = trim, PNL = panel.

Here are operation/element names already in this library, for matching reference:
${libraryNames.length ? libraryNames.map((n) => '- ' + n).join('\n') : '(library is currently empty)'}

For each extracted operation, if it plausibly matches one of the library names above (allowing for abbreviation/shorthand differences), set "matched_library_name" to that exact library name string, copied exactly. Otherwise set it to null. Do not invent a library name that isn't in the list above.

Return ONLY strict JSON, no markdown formatting, in exactly this shape:
{"operations": [{"description": "string, the operation as written on the sheet", "matched_library_name": "string or null"}]}`;

    const imagePart = {
      inlineData: { data: req.file.buffer.toString('base64'), mimeType: req.file.mimetype },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('Gemini returned non-JSON:', responseText);
      return res.status(502).json({ error: 'Could not parse extraction result' });
    }

    const operations = Array.isArray(parsed.operations) ? parsed.operations : [];
    const rows = operations
      .filter((o) => o && o.description)
      .map((o) => {
        const match = o.matched_library_name ? nameToElement.get(String(o.matched_library_name).toLowerCase()) : null;
        return {
          description: String(o.description).trim(),
          matched_element: match
            ? { id: match.id, name: match.name, category: match.category, video_url: match.video_url, is_placeholder: match.is_placeholder }
            : null,
        };
      });

    res.json({ operations: rows });
  } catch (err) {
    console.error('extract-operations error:', err);
    if (err.status === 429) {
      return res.status(429).json({ error: 'Free-tier limit reached for the moment — wait a bit and try again.' });
    }
    res.status(500).json({ error: 'Extraction failed. Try a clearer photo, or try again shortly.' });
  }
});

// ------------------------------------------------------------
// CONFIRM / UNCONFIRM a style's operation list. Confirming locks the
// builder into "record missing videos" mode; unconfirming reopens
// editing. Purely a workflow gate — doesn't touch operations.
// ------------------------------------------------------------
// ------------------------------------------------------------
// CAPACITY STUDY — generates a downloadable .xlsx from client-computed
// rows (operation name, cycle time, pieces/hour, daily output). Video
// duration can only be read reliably in the browser (via the <video>
// element's metadata), so the frontend measures each clip and sends the
// finished numbers here purely to be turned into a real spreadsheet file.
// ------------------------------------------------------------
router.post('/:id/capacity-study', requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to export' });

  try {
    const styleResult = await pool.query('select * from styles where id = $1', [req.params.id]);
    if (!styleResult.rows[0]) return res.status(404).json({ error: 'Style not found' });
    const style = styleResult.rows[0];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Capacity Study');

    sheet.columns = [
      { header: 'Operation Name', key: 'name', width: 40 },
      { header: 'Cycle Time (sec)', key: 'cycleTime', width: 18 },
      { header: 'Pieces / Hour', key: 'piecesPerHour', width: 16 },
      { header: 'Daily Output (8 hr)', key: 'dailyOutput', width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E1C8' } };

    rows.forEach((r) => {
      sheet.addRow({
        name: r.operation_name || '',
        cycleTime: Math.round((Number(r.cycle_time_seconds) || 0) * 10) / 10,
        piecesPerHour: Math.round(Number(r.pieces_per_hour) || 0),
        dailyOutput: Math.round(Number(r.daily_output) || 0),
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="line-${style.line_number || style.id}-capacity-study.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('capacity-study error:', err);
    res.status(500).json({ error: 'Could not generate capacity study' });
  }
});

router.patch('/:id/confirm', requireAuth, async (req, res) => {
  const confirmed = req.body.confirmed !== false;
  try {
    const result = await pool.query(
      `update styles set confirmed_at = $1, updated_at = now() where id = $2 returning *`,
      [confirmed ? new Date() : null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// CLONE a style: copies the entire operation list into a new style.
// Only the fields that differ (e.g. line_number) need to be passed in --
// anything omitted is carried over from the source style.
// ------------------------------------------------------------
router.post('/:id/clone', requireAuth, async (req, res) => {
  const { style_name, brand, garment_type, line_number } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const source = await client.query('select * from styles where id = $1', [req.params.id]);
    if (!source.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source style not found' });
    }
    const src = source.rows[0];

    const newStyle = await client.query(
      `insert into styles (brand, style_name, garment_type, line_number, cloned_from_style_id, created_by)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [
        brand !== undefined ? brand : src.brand,
        style_name || src.style_name,
        garment_type || src.garment_type,
        line_number !== undefined ? line_number : null,
        src.id,
        req.user.id,
      ]
    );
    const style = newStyle.rows[0];

    const sourceOps = await client.query(
      'select * from operations where style_id = $1 order by sequence_no',
      [src.id]
    );

    for (const op of sourceOps.rows) {
      await client.query(
        `insert into operations (style_id, sequence_no, station_name, notecard_text, element_id, element_version_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [style.id, op.sequence_no, op.station_name, op.notecard_text, op.element_id, op.element_version_id]
      );
    }

    await client.query('COMMIT');

    const operations = await pool.query(
      `select o.*, e.name as element_name, e.video_url, e.category, e.is_placeholder from operations o
       join elements e on e.id = o.element_id
       where o.style_id = $1 order by o.sequence_no`,
      [style.id]
    );
    res.status(201).json({ ...style, operations: operations.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// REORDER a style's operations. Body: { order: [operationId, ...] }
// listing every operation id belonging to this style in the new sequence.
// Uses a two-pass update (negative sequence_no first) so the
// unique(style_id, sequence_no) constraint never collides mid-update.
// ------------------------------------------------------------
router.patch('/:id/operations/reorder', requireAuth, async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order must be a non-empty array of operation ids' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('select id from operations where style_id = $1', [req.params.id]);
    const existingIds = new Set(existing.rows.map(r => r.id));
    const orderIds = new Set(order);
    const matches = order.length === existingIds.size && order.every(id => existingIds.has(id));
    if (!matches || orderIds.size !== order.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'order must include exactly the operations belonging to this style, each once' });
    }

    for (let idx = 0; idx < order.length; idx++) {
      await client.query('update operations set sequence_no = $1 where id = $2', [-(idx + 1), order[idx]]);
    }
    for (let idx = 0; idx < order.length; idx++) {
      await client.query('update operations set sequence_no = $1, updated_at = now() where id = $2', [idx + 1, order[idx]]);
    }

    await client.query('COMMIT');

    const result = await pool.query(
      `select o.*, e.name as element_name, e.video_url, e.category, e.is_placeholder from operations o
       join elements e on e.id = o.element_id
       where o.style_id = $1 order by o.sequence_no`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// GENERATE QR CODES for every operation in a style. Each QR encodes
// the URL to the public viewer page (/view/:operationId — Phase 6),
// which is what the operator's camera actually hits on the line.
// Safe to re-run after reordering or swapping an element: the QR
// content is just the operation id, so it never changes even if the
// underlying video does.
// ------------------------------------------------------------
router.post('/:id/generate-qr-codes', requireAuth, async (req, res) => {
  try {
    const operations = await pool.query(
      'select id from operations where style_id = $1 order by sequence_no',
      [req.params.id]
    );
    if (operations.rows.length === 0) {
      return res.status(404).json({ error: 'No operations found for this style' });
    }

    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    const updated = [];
    for (const op of operations.rows) {
      const viewUrl = `${baseUrl}/view/${op.id}`;
      const qrBuffer = await QRCode.toBuffer(viewUrl, { width: 400, margin: 1 });
      const qr_code_url = await fileStorage.uploadBufferAtKey(qrBuffer, `qrcodes/${op.id}.png`, 'image/png');

      const result = await pool.query(
        `update operations set qr_code_url = $1, updated_at = now() where id = $2 returning *`,
        [qr_code_url, op.id]
      );
      updated.push(result.rows[0]);
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// PRINT SHEET — lays out every operation's QR code for this style
// onto A4 pages (3x4 grid), in sequence order, one PDF download.
// Call generate-qr-codes first if any operation is missing a code.
// ------------------------------------------------------------
router.get('/:id/print-sheet', requireAuth, async (req, res) => {
  try {
    const styleResult = await pool.query('select * from styles where id = $1', [req.params.id]);
    if (!styleResult.rows[0]) return res.status(404).json({ error: 'Style not found' });

    const operations = await pool.query(
      `select o.*, e.name as element_name from operations o
       join elements e on e.id = o.element_id
       where o.style_id = $1 order by o.sequence_no`,
      [req.params.id]
    );
    if (operations.rows.length === 0) {
      return res.status(404).json({ error: 'No operations found for this style' });
    }
    const missing = operations.rows.filter(op => !op.qr_code_url);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `${missing.length} operation(s) have no QR code yet — call POST /:id/generate-qr-codes first`,
      });
    }

    const style = styleResult.rows[0];
    const margin = 40;
    const rowsPerPage = 3; // always exactly 3 slots per page
    const innerGap = 32; // horizontal gap between the text and its QR code
    const slotPadding = 22; // breathing room above/below each operation within its slot
    const qrSize = 180;
    const maxLabelFontSize = 36;
    const minLabelFontSize = 16;

    const doc = new PDFDocument({ size: 'A4', margin });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="line-${style.line_number || style.id}-qr-sheet.pdf"`
    );
    doc.pipe(res);

    doc.registerFont('LabelFont', path.join(__dirname, '..', 'fonts', 'calibrib.ttf'));

    const pageWidth = doc.page.width - margin * 2;
    const pageHeight = doc.page.height - margin * 2;
    const textWidth = pageWidth - qrSize - innerGap;
    const slotHeight = pageHeight / rowsPerPage;
    const maxTextHeight = slotHeight - slotPadding * 2;

    // Slots are a fixed size (page height / 3) so every page holds exactly 3
    // operations. The label defaults to 36pt but shrinks (never below 16pt)
    // for unusually long operation names, so nothing ever overflows its slot.
    function fitLabelFontSize(label) {
      let size = maxLabelFontSize;
      while (size > minLabelFontSize) {
        doc.font('LabelFont').fontSize(size);
        if (doc.heightOfString(label, { width: textWidth, align: 'center' }) <= maxTextHeight) break;
        size -= 2;
      }
      doc.font('LabelFont').fontSize(size);
      return { size, height: doc.heightOfString(label, { width: textWidth, align: 'center' }) };
    }

    // Fetch every QR image up front (in parallel) — they may live on R2 now,
    // not a local path, so pdfkit needs the actual bytes rather than a path.
    const qrBuffers = await Promise.all(operations.rows.map((op) => fileStorage.getBuffer(op.qr_code_url)));

    let y = margin;
    let rowInPage = 0;

    operations.rows.forEach((op, idx) => {
      if (rowInPage >= rowsPerPage) {
        doc.addPage();
        y = margin;
        rowInPage = 0;
      }

      const label = `${op.sequence_no}. ${op.element_name}`;
      const { size: fontSize, height: textHeight } = fitLabelFontSize(label);

      const textX = margin;
      const textY = y + (slotHeight - textHeight) / 2;
      const qrX = margin + textWidth + innerGap;
      const qrY = y + (slotHeight - qrSize) / 2;

      doc.font('LabelFont').fontSize(fontSize).fillColor('#000')
        .text(label, textX, textY, { width: textWidth, align: 'center' });

      doc.image(qrBuffers[idx], qrX, qrY, { width: qrSize, height: qrSize });

      y += slotHeight;
      rowInPage++;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Returns a style with all its operations (and each operation's linked element)
router.get('/:id', async (req, res) => {
  try {
    const style = await pool.query('select * from styles where id = $1', [req.params.id]);
    if (!style.rows[0]) return res.status(404).json({ error: 'Not found' });
    const operations = await pool.query(
      `select o.*, e.name as element_name, e.video_url, e.category, e.is_placeholder from operations o
       join elements e on e.id = o.element_id
       where o.style_id = $1 order by o.sequence_no`,
      [req.params.id]
    );
    res.json({ ...style.rows[0], operations: operations.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
