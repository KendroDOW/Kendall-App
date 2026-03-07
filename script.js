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

// Lookup product by barcode using Open Food Facts API
async function lookupProductByBarcode(barcode) {
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await response.json();

    if (data.status === 1 && data.product) {
      const product = data.product;
      return {
        name: product.product_name || product.generic_name || 'Unknown Product',
        brand: product.brands || '',
        categoryTags: product.categories_tags || product.categories || [],
      };
    } else {
      return { name: 'Product Not Found', brand: '', categoryTags: [] };
    }
  } catch (err) {
    console.error('Product lookup error:', err);
    return { name: 'Error Looking Up Product', brand: '', categoryTags: [] };
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

// Get approximate location using browser geolocation + reverse geocode
async function getCurrentLocation() {
  if (!navigator.geolocation) {
    console.warn('Geolocation not supported');
    return 'Unknown Location';
  }

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      });
    });

    const { latitude, longitude } = position.coords;

    // Reverse geocode using BigDataCloud (free, no key, fast)
    const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
    const data = await response.json();

    if (data.city && data.locality) {
      return `${data.city}, ${data.principalSubdivision || data.countryName}`;
    } else if (data.city) {
      return data.city;
    } else {
      return 'Unknown Location';
    }
  } catch (err) {
    console.warn('Geolocation error:', err);
    return 'Unknown Location';
  }
}

// Suggest store name based on city + brand hint
function suggestStoreName(city, brandHint = '') {
  const lowerCity = city.toLowerCase();
  const lowerBrand = brandHint.toLowerCase();

  // Common chains in Saint George, UT area (expand this list later)
  const utahChains = [
    { name: 'Walmart', keywords: ['walmart', 'supercenter', 'walmart neighborhood market'] },
    { name: "Smith's", keywords: ['smiths', 'smith\'s', 'kroger'] },
    { name: 'Maceys', keywords: ['maceys', 'macey\'s'] },
    { name: 'Harmons', keywords: ['harmons'] },
    { name: 'Albertsons', keywords: ['albertsons', 'safeway'] },
  ];

  // If brand hint points to a chain
  for (const chain of utahChains) {
    if (lowerBrand.includes(chain.keywords[0])) {
      return chain.name;
    }
  }

  // Fallback from city
  if (lowerCity.includes('saint george') || lowerCity.includes('st george')) {
    return 'Walmart'; // Most common in area — customize as needed
  }

  return `${city} Grocery Store`;
}

// Login from welcome page (runs on index.html)
document.getElementById('start-login-btn')?.addEventListener('click', () => {
  console.log('Login button clicked – setting flag and redirecting');
  localStorage.setItem('deductEatsLoggedIn', 'true');
  window.location.href = 'home.html';
});

// Login state check (only on protected pages)
function checkLogin() {
  if (!localStorage.getItem('deductEatsLoggedIn')) {
    window.location.href = 'index.html';
  }
}

// Run login check on all pages except index.html
const currentPath = window.location.pathname.toLowerCase();
if (!currentPath.endsWith('index.html') && !currentPath.endsWith('/')) {
  checkLogin();
}

// Logout (shared across all pages)
document.getElementById('logout-btn')?.addEventListener('click', () => {
  if (confirm("Log out?")) {
    localStorage.removeItem('deductEatsLoggedIn');
    window.location.href = 'index.html';
  }
});

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

    // Get location while scanning
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
        alert('Barcode scanned: ' + code + '\nFound: ' + product.name);
      }

      // Pre-fill one item
      currentItems = [{
        name: product.name,
        price: 0,
        category: suggestCategory(product.categoryTags),
        deductible: ''
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

      // Focus on price field
      document.querySelector('.price')?.focus();
    });
  });

  document.getElementById('stop-barcode-scan')?.addEventListener('click', () => {
    if (barcodeScannerActive) {
      Quagga.stop();
      document.getElementById('barcode-preview-container').style.display = 'none';
      barcodeScannerActive = false;
      document.getElementById('barcode-scan-btn').style.display = 'block';
      document.getElementById('manual-btn').style.display = 'block';
    }
  });

  // Manual entry logic
  const manualBtn = document.getElementById('manual-btn');
  const editSection = document.getElementById('edit-section');
  const itemsContainer = document.getElementById('items-container');
  const addItemBtn = document.getElementById('add-item-btn');
  const saveReceiptBtn = document.getElementById('save-receipt');
  const cancelEditBtn = document.getElementById('cancel-edit');

  manualBtn.addEventListener('click', async () => {
    currentItems = [];
    currentDate = new Date().toISOString().split('T')[0];
    const cityFromGeo = await getCurrentLocation();
    currentLocation = suggestStoreName(cityFromGeo);
    editSection.style.display = 'block';
    document.getElementById('barcode-scan-btn').style.display = 'none';
    document.getElementById('manual-btn').style.display = 'none';
    document.getElementById('receipt-location').value = currentLocation;
    document.getElementById('receipt-date').value = currentDate;
    renderItems();
  });

  function renderItems() {
    itemsContainer.innerHTML = '';
    currentItems.forEach((item, index) => {
      const block = document.createElement('div');
      block.className = 'item-block';
      block.innerHTML = `
        <h4>Item ${index + 1}</h4>
        
        <div class="form-field">
          <label>Item Name</label>
          <input type="text" value="${item.name}" data-index="${index}" class="name" placeholder="e.g. Gluten-free bread" />
        </div>
        
        <div class="form-field">
          <label>Price (in $)</label>
          <input type="number" step="0.01" value="${item.price}" data-index="${index}" class="price" placeholder="e.g. 6.99" />
        </div>
        
        <div class="form-field">
          <label>Category</label>
          <select data-index="${index}" class="category">
            <option ${item.category==='None'?'selected':''}>None</option>
            <option ${item.category==='Gluten-Free'?'selected':''}>Gluten-Free</option>
            <option ${item.category==='Keto'?'selected':''}>Keto</option>
            <option ${item.category==='Low-Sodium'?'selected':''}>Low-Sodium</option>
            <option ${item.category==='Other'?'selected':''}>Other</option>
          </select>
        </div>
        
        <div class="form-field">
          <label>Deductible (extra amount in $)</label>
          <input type="number" step="0.01" value="${item.deductible || ''}" data-index="${index}" class="deductible" placeholder="e.g. 2.50 – only the extra cost over regular version" />
        </div>
        
        <button class="remove-item" data-index="${index}">Remove Item</button>
      `;
      itemsContainer.appendChild(block);
    });

    // Event delegation
    itemsContainer.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.matches('.name, .price, .category, .deductible')) return;
      const idx = el.dataset.index;
      const key = el.className;
      currentItems[idx][key] = el.value;
      if (key === 'price' || key === 'deductible') {
        currentItems[idx][key] = parseFloat(el.value) || 0;
      }
    });

    itemsContainer.addEventListener('click', (e) => {
      if (!e.target.matches('.remove-item')) return;
      const idx = e.target.dataset.index;
      currentItems.splice(idx, 1);
      renderItems();
    });
  }

  addItemBtn.addEventListener('click', () => {
    currentItems.push({ name: '', price: 0, category: 'None', deductible: '' });
    renderItems();
  });

  saveReceiptBtn.addEventListener('click', async () => {
    currentDate = document.getElementById('receipt-date').value;
    currentLocation = document.getElementById('receipt-location').value;

    if (currentItems.length === 
