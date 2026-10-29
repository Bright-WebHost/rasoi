/**
 * Rasoi Operational Data Import Script
 *
 * Imports operational configuration, menu items, table definitions, and
 * restaurant settings exported from Pabbas into the Rasoi Supabase project.
 *
 * SAFETY GUARANTEES:
 * - Only connects to Rasoi Supabase (xwakalryzigtvoirwooq).
 * - Aborts immediately if pointed at any other database.
 * - Imports zero customer, order, chat, rider, or staff credential data.
 * - Enforces restaurant_tables.current_order_id = null.
 * - Preserves Rasoi identity (restaurant_name = 'Rasoi', orders_paused = 'true').
 * - Idempotent upserts on unique constraints (item_number, table_number, key, info_key).
 * - Supports --dry-run mode for pre-flight verification.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load environment from Rasoi's .env.local
const envPath = path.resolve(__dirname, '../../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('Error: .env.local not found at', envPath);
  process.exit(1);
}
require('dotenv').config({ path: envPath });

const TARGET_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const TARGET_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;

// 2. Strict safety verification
const EXPECTED_PROJECT_REF = 'xwakalryzigtvoirwooq';
if (!TARGET_SUPABASE_URL || !TARGET_SUPABASE_URL.includes(EXPECTED_PROJECT_REF)) {
  console.error(`FATAL SAFETY ERROR: NEXT_PUBLIC_SUPABASE_URL is not pointing to Rasoi (${EXPECTED_PROJECT_REF}).`);
  console.error('Found:', TARGET_SUPABASE_URL);
  process.exit(1);
}

if (!TARGET_SERVICE_KEY) {
  console.error('FATAL: SUPABASE_SECRET_KEY missing in Rasoi .env.local.');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
console.log(`=== Rasoi Operational Import ${isDryRun ? '(DRY RUN)' : '(LIVE WRITES)'} ===`);
console.log(`Target Supabase: ${TARGET_SUPABASE_URL}`);

const supabase = createClient(TARGET_SUPABASE_URL, TARGET_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  // 3. Locate export file
  const candidatePaths = [
    path.resolve(__dirname, 'pabbas/pabbas_operational_export.json'),
    path.resolve(__dirname, '../../scripts/import/pabbas/pabbas_operational_export.json'),
    path.resolve('C:/brightmedia/pabbas/pabbas_operational_export.json')
  ];

  let exportPath = candidatePaths.find(p => fs.existsSync(p));
  if (!exportPath) {
    console.error('Error: Could not locate pabbas_operational_export.json in candidate locations:');
    candidatePaths.forEach(p => console.error('  -', p));
    process.exit(1);
  }

  console.log(`Using export file: ${exportPath}`);
  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

  // 4. Locate assets directory
  const candidateAssetDirs = [
    path.resolve(path.dirname(exportPath), 'pabbas_menu_assets'),
    path.resolve(__dirname, 'pabbas/pabbas_menu_assets'),
    path.resolve('C:/brightmedia/pabbas/pabbas_menu_assets')
  ];
  let assetDir = candidateAssetDirs.find(d => fs.existsSync(d));
  console.log(`Asset directory: ${assetDir || 'NOT FOUND (Skipping asset upload)'}`);

  // -------------------------------------------------------------
  // STEP A: Upload storage assets to Rasoi 'menu_images' bucket
  // -------------------------------------------------------------
  if (assetDir) {
    console.log('\n--- Step A: Uploading Storage Assets to Rasoi menu_images Bucket ---');
    const filesToUpload = [
      { local: '2kjos38g0da_1791617312262.jpg', remote: '2kjos38g0da_1791617312262.jpg', mime: 'image/jpeg' },
      { local: '8b6i97005tc_1791883259274.png', remote: '8b6i97005tc_1791883259274.png', mime: 'image/png' },
      { local: 'branding/logo-1792226243091.png', remote: 'branding/logo-1792226243091.png', mime: 'image/png' },
      { local: 'branding/logo-1792395214824.png', remote: 'branding/logo-1792395214824.png', mime: 'image/png' }
    ];

    for (const f of filesToUpload) {
      const fullPath = path.join(assetDir, f.local);
      if (fs.existsSync(fullPath)) {
        const fileBuffer = fs.readFileSync(fullPath);
        console.log(`  Preparing to upload ${f.remote} (${(fileBuffer.length / 1024).toFixed(1)} KB)...`);
        if (!isDryRun) {
          const { data, error } = await supabase.storage.from('menu_images').upload(f.remote, fileBuffer, {
            contentType: f.mime,
            upsert: true
          });
          if (error) console.error(`    Upload failed for ${f.remote}:`, error.message);
          else console.log(`    Uploaded successfully.`);
        } else {
          console.log(`    [DRY RUN] Would upload to bucket 'menu_images' at path '${f.remote}'.`);
        }
      } else {
        console.warn(`    Warning: Local asset not found at ${fullPath}`);
      }
    }
  }

  // -------------------------------------------------------------
  // STEP B: Import menu_items
  // -------------------------------------------------------------
  console.log('\n--- Step B: Importing menu_items ---');
  const sourceItems = exportData.tables.menu_items || [];
  console.log(`Found ${sourceItems.length} menu items in export.`);

  const PABBAS_URL = 'https://clqzctntkwzahdfjeqlx.supabase.co';
  const RASOI_URL = TARGET_SUPABASE_URL.replace(/\/$/, '');

  const transformedItems = sourceItems.map(item => {
    // Rewrite storage URL from Pabbas to Rasoi
    let imageUrl = item.image_url || '';
    if (imageUrl.includes(PABBAS_URL)) {
      imageUrl = imageUrl.replace(PABBAS_URL, RASOI_URL);
    }

    return {
      id: item.id,
      item_number: item.item_number,
      item_name: item.item_name,
      category: item.category,
      price: item.price,
      available: item.available ?? true,
      vegetarian: true, // Explicit column in Rasoi
      description: item.description || '',
      image_url: imageUrl,
      variants: item.variants || null,
      is_pinned: item.is_pinned ?? false,
      created_at: item.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  });

  if (!isDryRun) {
    const { data, error } = await supabase
      .from('menu_items')
      .upsert(transformedItems, { onConflict: 'item_number' });

    if (error) console.error('  Failed to upsert menu_items:', error.message);
    else console.log(`  Upserted ${transformedItems.length} menu_items into Rasoi.`);
  } else {
    console.log(`  [DRY RUN] Would upsert ${transformedItems.length} menu_items.`);
    console.log(`  Sample item:`, transformedItems[0]);
  }

  // -------------------------------------------------------------
  // STEP C: Import restaurant_tables
  // -------------------------------------------------------------
  console.log('\n--- Step C: Importing restaurant_tables ---');
  const sourceTables = exportData.tables.restaurant_tables || [];
  const transformedTables = sourceTables.map(t => ({
    id: t.id,
    table_number: t.table_number,
    capacity: 4, // Required NOT NULL in Rasoi schema
    qr_code_url: t.qr_code_url || null,
    is_active: t.is_active ?? false,
    current_order_id: null, // Always null - completely decoupled from orders
    created_at: t.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  if (!isDryRun) {
    const { data, error } = await supabase
      .from('restaurant_tables')
      .upsert(transformedTables, { onConflict: 'table_number' });

    if (error) console.error('  Failed to upsert restaurant_tables:', error.message);
    else console.log(`  Upserted ${transformedTables.length} restaurant_tables into Rasoi.`);
  } else {
    console.log(`  [DRY RUN] Would upsert ${transformedTables.length} restaurant_tables.`);
    console.log(`  Sample table:`, transformedTables[0]);
  }

  // -------------------------------------------------------------
  // STEP D: Import restaurant_info (AI Knowledge Base)
  // -------------------------------------------------------------
  console.log('\n--- Step D: Importing restaurant_info ---');
  const sourceInfo = exportData.tables.restaurant_info || [];
  const transformedInfo = sourceInfo.map(r => ({
    id: r.id,
    info_key: r.info_key,
    info_value: r.info_value,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  if (!isDryRun) {
    const { data, error } = await supabase
      .from('restaurant_info')
      .upsert(transformedInfo, { onConflict: 'info_key' });

    if (error) console.error('  Failed to upsert restaurant_info:', error.message);
    else console.log(`  Upserted ${transformedInfo.length} restaurant_info rows into Rasoi.`);
  } else {
    console.log(`  [DRY RUN] Would upsert ${transformedInfo.length} restaurant_info rows.`);
    console.log(`  Sample info:`, transformedInfo[0]);
  }

  // -------------------------------------------------------------
  // STEP E: Import settings (preserving Rasoi brand & state)
  // -------------------------------------------------------------
  console.log('\n--- Step E: Importing settings ---');
  const sourceSettings = exportData.tables.settings || [];

  // Keys to safely port over as operational baseline
  const ALLOWED_SETTING_KEYS = [
    'open_time',
    'close_time',
    'hours',
    'order_types',
    'delivery_fee',
    'min_order',
    'free_delivery_above',
    'delivery_note',
    'gst_percent',
    'payment_methods',
    'auto_print',
    'unknown_policy',
    'google_review_url'
  ];

  const transformedSettings = [];
  for (const s of sourceSettings) {
    if (ALLOWED_SETTING_KEYS.includes(s.key)) {
      transformedSettings.push({
        key: s.key,
        value: s.value,
        updated_at: new Date().toISOString()
      });
    }
  }

  // Explicitly guarantee Rasoi settings are not altered
  console.log('  Preserved keys: restaurant_name="Rasoi", orders_paused="true".');
  console.log(`  Porting ${transformedSettings.length} operational baseline settings.`);

  if (!isDryRun) {
    const { data, error } = await supabase
      .from('settings')
      .upsert(transformedSettings, { onConflict: 'key' });

    if (error) console.error('  Failed to upsert settings:', error.message);
    else console.log(`  Upserted ${transformedSettings.length} settings into Rasoi.`);
  } else {
    console.log(`  [DRY RUN] Would upsert ${transformedSettings.length} settings.`);
    console.log(`  Ported keys:`, transformedSettings.map(s => s.key).join(', '));
  }

  console.log('\n=== Import Plan Processing Complete ===');
}

main().catch(err => {
  console.error('Fatal error during import execution:', err);
  process.exit(1);
});
