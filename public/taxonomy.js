// Category taxonomy for the guided operation-builder flow.
// Sections are shelves in the physical library; categories are the
// subsections on each shelf; each category carries a researched list of
// specific construction types (e.g. Collar -> Peter Pan / Mandarin /
// Spread / ...) so the supervisor picks the exact type rather than
// browsing whatever happens to already be in the library.
// Edit this file to add/rename sections, categories, or types — nothing
// else in the app needs to change.

var SECTIONS = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'dress', label: 'Dress' },
];

var CATEGORY_TAXONOMY = {
  top: [
    { value: 'collar', label: 'Collar', types: [
      'Peter Pan Collar', 'Mandarin / Band Collar', 'Spread Collar', 'Point Collar',
      'Button-Down Collar', 'Club Collar', 'Wing Collar', 'Convertible Collar',
      'Shawl Collar', 'Cuban / Camp Collar',
    ] },
    { value: 'placket', label: 'Placket', types: [
      'Standard Placket', 'Concealed / Fly-Front Placket', 'Full Placket',
      'Half Placket', 'No Placket',
    ] },
    { value: 'shoulder-attach', label: 'Shoulder Attach', types: [
      'Set-In Shoulder Seam', 'Raglan Shoulder Seam', 'Dropped Shoulder Seam', 'Yoke Shoulder',
    ] },
    { value: 'sleeve', label: 'Sleeve Type', types: [
      'Full (Long) Sleeve — No Placket', 'Full (Long) Sleeve — With Placket',
      'Half (Short) Sleeve — No Placket', 'Half (Short) Sleeve — With Placket',
      '3/4 Sleeve', 'Raglan Sleeve', 'Kimono Sleeve', 'Dolman Sleeve',
      'Bishop Sleeve', 'Puff Sleeve', 'Bell / Peasant Sleeve', 'Cap Sleeve',
    ] },
    { value: 'cuff', label: 'Cuff', types: [
      'Barrel Cuff (Button)', 'French Cuff', 'Convertible Cuff', 'Rounded Cuff',
      'Ribbed / Elastic Cuff', 'No Cuff',
    ] },
    { value: 'pocket', label: 'Pocket Type', types: [
      'Patch Pocket', 'Welt Pocket', 'Besom / Jetted Pocket', 'Flap Pocket',
      'Slant / Slash Pocket', 'Chest Pocket', 'Kangaroo Pocket', 'No Pocket',
    ] },
    { value: 'yoke', label: 'Yoke', types: [
      'Plain Back Yoke', 'Split Back Yoke', 'Western Yoke', 'No Yoke',
    ] },
    { value: 'hem', label: 'Hem', types: [
      'Straight Hem', 'Curved / Shirttail Hem', 'Rolled Hem', 'Scalloped Hem',
    ] },
    { value: 'closure', label: 'Closure Type', types: [
      'Button Closure', 'Zip Closure', 'Snap Closure', 'Hook-and-Eye Closure',
      'Velcro / Hook-Loop Closure', 'Drawstring / Tie Closure', 'Toggle Closure',
    ] },
    { value: 'label', label: 'Label / Care Tag', types: [
      'Neck Label', 'Care / Wash Label', 'Brand Label', 'Hang Tag',
    ] },
  ],
  bottom: [
    { value: 'waistband', label: 'Waistband Type', types: [
      'Elastic Waistband', 'Straight / Fitted Waistband', 'Contoured Waistband',
      'Drawstring Waistband', 'Paperbag Waistband', 'High-Waisted Waistband',
    ] },
    { value: 'pocket', label: 'Pocket Type', types: [
      'Front Slant Pocket', 'Back Patch Pocket', 'Back Welt Pocket', 'Coin Pocket',
      'Cargo Pocket', 'In-Seam Pocket', 'No Pocket',
    ] },
    { value: 'closure', label: 'Closure Type', types: [
      'Button-Fly Closure', 'Zip-Fly Closure', 'Elastic / No Closure',
      'Drawstring Closure', 'Button-and-Hook Closure',
    ] },
    { value: 'fly', label: 'Fly / Zipper', types: [
      'Zip Fly', 'Button Fly', 'No Fly (Elastic Waist)',
    ] },
    { value: 'belt-loop', label: 'Belt Loop', types: [
      'Standard Belt Loop', 'D-Ring Loop', 'No Belt Loop',
    ] },
    { value: 'hem', label: 'Hem', types: [
      'Straight Hem', 'Cuffed Hem', 'Raw / Unfinished Hem',
    ] },
    { value: 'label', label: 'Label / Care Tag', types: [
      'Neck Label', 'Care / Wash Label', 'Brand Label', 'Hang Tag',
    ] },
  ],
  dress: [
    { value: 'collar', label: 'Collar', types: [
      'Peter Pan Collar', 'Mandarin / Band Collar', 'Spread Collar', 'Shawl Collar', 'No Collar',
    ] },
    { value: 'placket', label: 'Placket', types: [
      'Standard Placket', 'Concealed Placket', 'No Placket',
    ] },
    { value: 'sleeve', label: 'Sleeve Type', types: [
      'Full (Long) Sleeve', 'Half (Short) Sleeve', '3/4 Sleeve', 'Bishop Sleeve',
      'Puff Sleeve', 'Bell / Peasant Sleeve', 'Cap Sleeve', 'Sleeveless',
    ] },
    { value: 'waist-seam', label: 'Waist Seam', types: [
      'Natural Waist Seam', 'Empire Waist Seam', 'Dropped Waist Seam', 'No Waist Seam (Shift)',
    ] },
    { value: 'skirt-hem', label: 'Skirt Hem', types: [
      'Straight Hem', 'A-Line Hem', 'Flared Hem', 'Handkerchief Hem',
      'High-Low / Mullet Hem', 'Fishtail / Mermaid Hem',
    ] },
    { value: 'closure', label: 'Closure Type', types: [
      'Back Zip Closure', 'Side Zip Closure', 'Button-Front Closure', 'Wrap / Tie Closure',
    ] },
    { value: 'pocket', label: 'Pocket Type', types: [
      'Side Seam Pocket', 'Patch Pocket', 'No Pocket',
    ] },
    { value: 'label', label: 'Label / Care Tag', types: [
      'Neck Label', 'Care / Wash Label', 'Brand Label', 'Hang Tag',
    ] },
  ],
};

function categoriesFor(section) {
  return CATEGORY_TAXONOMY[section] || [];
}

function categoryTypes(section, categoryValue) {
  var cats = categoriesFor(section);
  for (var i = 0; i < cats.length; i++) {
    if (cats[i].value === categoryValue) return cats[i].types || [];
  }
  return [];
}
