// Save as: routes/elements.js  (replaces the Phase 2 version)
const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// Helper: accepts either a JSON array string '["shirt","pant"]'
// or a plain comma-separated string 'shirt,pant' (easier to test from terminal)
function parseGarmentTypes(input) {
  if (!input) return [];
  try {
    return JSON.parse(input);
  } catch (e) {
    return input.split(',').map(s => s.trim()).filter(Boolean);
  }
}

// ------------------------------------------------------------
// LIST / SEARCH elements
// GET /api/elements?garment_type=shirt&category=closures&search=placket
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  const { garment_type, category, search } = req.query;
  let query = 'select * from elements where is_active = true and scope = $1';
  const params = ['permanent'];

  if (garment_type) {
    params.push(garment_type);
    query += ` and $${params.length} = any(garment_types)`;
  }
  if (category) {
    params.push(category);
    query += ` and category = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` and name ilike $${params.length}`;
  }
  query += ' order by category, name';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// GET single element
// ------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('select * from elements where id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// GET variants of a base element (e.g. "Button Placket" -> "Button Placket with Lace")
// ------------------------------------------------------------
router.get('/:id/variants', async (req, res) => {
  try {
    const result = await pool.query(
      'select * from elements where parent_element_id = $1 and is_active = true',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// CREATE a new element with a video attached (field name: "video")
// Also saves version 1 into element_versions for history.
// ------------------------------------------------------------
router.post('/', requireAuth, upload.single('video'), async (req, res) => {
  const { name, category, garment_types, defect_notes, parent_element_id, scope, is_placeholder } = req.body;
  const video_url = req.file ? `/uploads/${req.file.filename}` : null;
  const garmentTypesArray = parseGarmentTypes(garment_types);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const elementResult = await client.query(
      `insert into elements (name, category, garment_types, video_url, defect_notes, parent_element_id, scope, created_by, is_placeholder)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [
        name,
        category || null,
        garmentTypesArray,
        video_url,
        defect_notes || null,
        parent_element_id || null,
        scope || 'permanent',
        req.user.id,
        is_placeholder === 'true' || is_placeholder === true,
      ]
    );
    const element = elementResult.rows[0];

    if (video_url) {
      await client.query(
        `insert into element_versions (element_id, version_no, video_url, defect_notes, created_by)
         values ($1, 1, $2, $3, $4)`,
        [element.id, video_url, defect_notes || null, req.user.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(element);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// EDIT element metadata (name, category, defect_notes, scope)
// Does NOT touch the video — use the /versions endpoint below for that.
// ------------------------------------------------------------
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, category, defect_notes, scope, garment_types } = req.body;
  const fields = [];
  const values = [];
  let i = 1;

  if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
  if (category !== undefined) { fields.push(`category = $${i++}`); values.push(category); }
  if (defect_notes !== undefined) { fields.push(`defect_notes = $${i++}`); values.push(defect_notes); }
  if (scope !== undefined) { fields.push(`scope = $${i++}`); values.push(scope); }
  if (garment_types !== undefined) { fields.push(`garment_types = $${i++}`); values.push(parseGarmentTypes(garment_types)); }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  fields.push(`updated_at = now()`);
  values.push(req.params.id);

  try {
    const result = await pool.query(
      `update elements set ${fields.join(', ')} where id = $${i} returning *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// UPLOAD A NEW VIDEO VERSION for an existing element.
// Old video is preserved in element_versions history; element.video_url
// becomes the new one, so every operation linking to this element
// automatically shows the latest video.
// ------------------------------------------------------------
router.post('/:id/versions', requireAuth, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'video file is required' });
  const new_video_url = `/uploads/${req.file.filename}`;
  const { defect_notes } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const maxVersion = await client.query(
      'select coalesce(max(version_no), 0) as max_v from element_versions where element_id = $1',
      [req.params.id]
    );
    const nextVersion = maxVersion.rows[0].max_v + 1;

    await client.query(
      `insert into element_versions (element_id, version_no, video_url, defect_notes, created_by)
       values ($1, $2, $3, $4, $5)`,
      [req.params.id, nextVersion, new_video_url, defect_notes || null, req.user.id]
    );

    const updateResult = await client.query(
      `update elements set video_url = $1, defect_notes = coalesce($2, defect_notes), is_placeholder = false, updated_at = now()
       where id = $3 returning *`,
      [new_video_url, defect_notes || null, req.params.id]
    );

    if (!updateResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Element not found' });
    }

    await client.query('COMMIT');
    res.status(201).json(updateResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// VIDEO HISTORY for an element — every past version, newest first.
// ------------------------------------------------------------
router.get('/:id/versions', async (req, res) => {
  try {
    const result = await pool.query(
      'select * from element_versions where element_id = $1 order by version_no desc',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;