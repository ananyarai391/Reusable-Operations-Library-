// Save as: routes/operations.js
const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// sequence_no is optional — if omitted, the operation is appended to the
// end of the style's current list (max sequence_no + 1).
router.post('/', requireAuth, async (req, res) => {
  const { style_id, sequence_no, station_name, notecard_text, element_id } = req.body;
  try {
    let seq = sequence_no;
    if (seq === undefined || seq === null) {
      const maxSeq = await pool.query(
        'select coalesce(max(sequence_no), 0) as max_seq from operations where style_id = $1',
        [style_id]
      );
      seq = maxSeq.rows[0].max_seq + 1;
    }

    const result = await pool.query(
      `insert into operations (style_id, sequence_no, station_name, notecard_text, element_id)
       values ($1,$2,$3,$4,$5) returning *`,
      [style_id, seq, station_name || null, notecard_text || null, element_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------
// EDIT a single operation — e.g. swap in a different element after
// cloning a style, without touching the rest of the operation list.
// ------------------------------------------------------------
router.patch('/:id', requireAuth, async (req, res) => {
  const { station_name, notecard_text, element_id, element_version_id } = req.body;
  const fields = [];
  const values = [];
  let i = 1;

  if (station_name !== undefined) { fields.push(`station_name = $${i++}`); values.push(station_name); }
  if (notecard_text !== undefined) { fields.push(`notecard_text = $${i++}`); values.push(notecard_text); }
  if (element_id !== undefined) { fields.push(`element_id = $${i++}`); values.push(element_id); }
  if (element_version_id !== undefined) { fields.push(`element_version_id = $${i++}`); values.push(element_version_id); }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  fields.push('updated_at = now()');
  values.push(req.params.id);

  try {
    const result = await pool.query(
      `update operations set ${fields.join(', ')} where id = $${i} returning *`,
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
// REMOVE an operation from a style's list (e.g. added by mistake
// during the guided build, caught on the review screen).
// ------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('delete from operations where id = $1 returning id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUBLIC endpoint — this is what the QR code will point to. No auth required.
router.get('/:id/view', async (req, res) => {
  try {
    const result = await pool.query(
      `select o.id, o.notecard_text, o.station_name, e.name as element_name,
              e.video_url, e.defect_notes, e.defect_photo_urls, e.is_placeholder
       from operations o
       join elements e on e.id = o.element_id
       where o.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
