// IndexedDB setup
const DB_NAME = 'DeductEatsDB';
const STORE_NAME = 'receipts';
let db;

async function initDB() {
  db = await idb.openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    },
  });
}
initDB();

// USDA average regular prices (per lb or unit, approximate 2026 values)
const usdaRegularPrices = {
  'oats': 0.55,          // regular rolled/quick oats per lb
  'flour': 0.50,         // all-purpose flour per lb
  'bread': 1.60,         // white bread per lb
  'pasta': 1.20,         // regular pasta per lb
  'sugar': 0.80,         // granulated sugar per lb
  'soup': 1.50,          // regular canned soup per can
  // Add more as needed
};

// Lookup product by barcode using Open Food Facts API – now extracts quantity
async function lookupProductByBarcode(barcode) {
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await response.json();

    if (data.status === 1 && data.product) {
      const product = data.product;
      let quantity = product.quantity || product.product_quantity || product.serving_size || '';
      if (!quantity && product.packaging_tags) {
        quantity = product.packaging_tags.join(', ');
      }
      console.log('[DEBUG] Extracted quantity:', quantity);
      return {
        name: product.product_name || product.generic_name || 'Unknown Product',
        brand: product.brands || '',
        categoryTags: product.categories_tags || product.categories || [],
        quantity: quantity, // e.g. "510 g (18 oz)"
      };
    } else {
      return { name: 'Product Not Found', brand: '', categoryTags: [], quantity: '' };
    }
  } catch (err) {
    console.error('Product lookup error:', err);
    return { name: 'Error Looking Up Product', brand: '', categoryTags: [], quantity: '' };
  }
}

// Simple category suggestion from tags
function suggestCategory(tags) {
  const tagString = (tags || []).join(' ').toLowerCase();
  if (tagString.includes('gluten-free')) return 'Gluten-Free';
  if (tagString.includes('keto') || tagString.includes('low-carb')) return 'Keto';
  if (tagString.includes('low-sodium') || tagString.includes('reduced sodium')) return 'Low-Sodium';
  return 'None';
}

// Convert quantity string to pounds (lb)
function convertToLb(quantityStr) {
  if (!quantityStr) return null;
  const match = quantityStr.match(/(\d+(\.\d+)?)\s*(g|oz|lb|kg)/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[3].toLowerCase();

  if (unit === 'lb') return value;
  if (unit === 'oz') return value / 16;
  if (unit === 'g') return value / 453.592;
  if (unit === 'kg') return value * 2.20462;

  return null;
}

// Suggest regular counterpart for common specialty items
function suggestRegularItem(itemName) {
  const lowerName = itemName.toLowerCase();
  console.log('[DEBUG] Product name for counterpart:', itemName);

  if (lowerName.includes('oat') || lowerName.includes('oats') || lowerName.includes('quick oat') || lowerName.includes('rolled oat')) {
    console.log('[DEBUG] Matched → oats');
    return 'oats';
  }
  if (lowerName.includes('flour')) return 'flour';
  if (lowerName.includes('bread')) return 'bread';
  if (lowerName.includes('pasta')) return 'pasta';
  if (lowerName.includes('sweetener') || lowerName.includes('sugar')) return 'sugar';
  if (lowerName.includes('soup')) return 'soup';

  console.log('[DEBUG] No regular counterpart match');
  return '';
}

// Suggest regular price from USDA table
function suggestRegularPrice(regularItem) {
  if (!regularItem) return null;
  const lowerItem = regularItem.toLowerCase();
  for (const [key, price] of Object.entries(usdaRegularPrices)) {
    if (lowerItem.includes(key)) {
      console.log('[DEBUG] USDA match found for:', key, 'price:', price);
      return price;
    }
  }
  console.log('[DEBUG] No USDA price suggestion for:', regularItem);
  return null;
}

// ... (getCurrentLocation and suggestStoreName remain unchanged)

// Page-specific logic
const currentPage = window.location.pathname.split('/').pop() || 'index.html';

if (currentPage === 'home.html') {
  let currentItems = [];
  let currentDate = '';
  let currentLocation = '';

  // Barcode scanning logic
  let barcodeScannerActive = false;

  document.getElementById('barcode-scan-btn')?.addEventListener('click', async () => {
    const previewContainer = document.getElementById('barcode-preview-container');
    previewContainer.style.display = 'block';
    barcodeScannerActive = true;

    const cityFromGeo = await getCurrentLocation();

    Quagga.init({
      inputStream: {
        name: "Live",
        type: "LiveStream",
        target: document.querySelector('#barcode-video-container'),
        constraints: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: "continuous",
          aspectRatio: { ideal: 16 / 9 },
        },
      },
      locator: {
        patchSize: "large",
        halfSample: true,
      },
      numOfWorkers: navigator.hardwareConcurrency || 4,
      frequency: 5,
      decoder: {
        readers: ["upc_reader", "ean_reader", "code_128_reader", "ean_8_reader"],
      },
      locate: true,
    }, function(err) {
      if (err) {
        console.error('Quagga init error:', err);
        alert('Failed to start barcode scanner. Check camera permission.');
        previewContainer.style.display = 'none';
        barcodeScannerActive = false;
        return;
      }
      Quagga.start();
      console.log('Quagga started');
    });

    Quagga.onProcessed((result) => {
      console.log('Frame processed – detection attempt:', result ? 'yes' : 'no');
    });

    Quagga.onDetected(async (result) => {
      const code = result.codeResult.code;
      console.log('Barcode detected:', code);
      Quagga.stop();
      document.getElementById('barcode-preview-container').style.display = 'none';
      barcodeScannerActive = false;

      const product = await lookupProductByBarcode(code);

      if (product.name === 'Product Not Found' || product.name === 'Error Looking Up Product') {
        alert('Barcode scanned: ' + code + '\nProduct not found in database.\nPlease enter name manually.');
      } else {
        alert('Barcode scanned: ' + code + '\nFound: ' + product.name + '\nQuantity: ' + (product.quantity || 'Not found'));
      }

      const regularItem = suggestRegularItem(product.name);
      const suggestedRegularPrice = suggestRegularPrice(regularItem);

      currentItems = [{
        name: product.name,
        price: 0,
        regularPrice: suggestedRegularPrice || 0,
        category: suggestCategory(product.categoryTags),
        deductible: '',
        quantity: product.quantity || ''
      }];

      currentLocation = suggestStoreName(cityFromGeo, product.brand);
      currentDate = new Date().toISOString().split('T')[0];

      const editSection = document.getElementById('edit-section');
      editSection.style.display = 'block';
      document.getElementById('barcode-scan-btn').style.display = 'none';
      document.getElementById('manual-btn').style.display = 'none';
      document.getElementById('receipt-location').value = currentLocation;
      document.getElementById('receipt-date').value = currentDate;
      renderItems();
      updateDeductibles();

      document.querySelector('.price')?.focus();
    });
  });

  // ... (stop-barcode-scan, manualBtn, renderItems, updateDeductibles, addItemBtn, saveReceiptBtn, cancelEditBtn remain unchanged from previous version)

  // Make sure updateDeductibles is defined here (from previous message)
  function updateDeductibles() {
    let totalDeduct = 0;
    let hasDeductible = false;

    currentItems.forEach((item, index) => {
      let deduct = 0;

      // If quantity exists, calculate total cost difference
      if (item.quantity) {
        const qtyInLb = convertToLb(item.quantity);
        if (qtyInLb) {
          const specialtyTotal = (item.price || 0) * qtyInLb;
          const regularTotal = (item.regularPrice || 0) * qtyInLb;
          deduct = specialtyTotal - regularTotal;
        } else {
          // Fallback if quantity parse fails
          deduct = (item.price || 0) - (item.regularPrice || 0);
        }
      } else {
        deduct = (item.price || 0) - (item.regularPrice || 0);
      }

      item.deductible = deduct > 0 ? deduct.toFixed(2) : '';
      totalDeduct += deduct > 0 ? deduct : 0;
      if (deduct > 0) hasDeductible = true;

      // Update visible deductible field
      const deductContainer = document.querySelector(`.deductible[data-index="${index}"]`)?.parentElement;
      if (deductContainer) {
        deductContainer.classList.toggle('hidden', !item.deductible);
      }
    });

    const summary = document.getElementById('deductible-summary');
    if (summary) {
      summary.style.display = hasDeductible ? 'block' : 'none';
      const totalSpan = document.getElementById('total-deductible');
      if (totalSpan) totalSpan.textContent = `$${totalDeduct.toFixed(2)}`;
    }
  }

  // ... (rest of history page logic remains unchanged)
}
