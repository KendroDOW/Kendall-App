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

// Suggest regular counterpart for common specialty items
function suggestRegularItem(itemName) {
  const lowerName = itemName.toLowerCase();
  if (lowerName.includes('oats') || lowerName.includes('quick oats')) return 'oats';
  if (lowerName.includes('flour')) return 'flour';
  if (lowerName.includes('bread')) return 'bread';
  if (lowerName.includes('pasta')) return 'pasta';
  if (lowerName.includes('sweetener') || lowerName.includes('sugar')) return 'sugar';
  if (lowerName.includes('soup')) return 'soup';
  return '';
}

// Suggest regular price from USDA table
function suggestRegularPrice(regularItem) {
  const lowerItem = regularItem.toLowerCase();
  for (const [key, price] of Object.entries(usdaRegularPrices)) {
    if (lowerItem.includes(key)) return price;
  }
  return null; // No suggestion
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

  const utahChains = [
    { name: 'Walmart', keywords: ['walmart', 'supercenter', 'walmart neighborhood market'] },
    { name: "Smith's", keywords: ['smiths', 'smith\'s', 'kroger'] },
    { name: 'Maceys', keywords: ['maceys', 'macey\'s'] },
    { name: 'Harmons', keywords: ['harmons'] },
    { name: 'Albertsons', keywords: ['albertsons', 'safeway'] },
  ];

  for (const chain of utahChains) {
    if (lowerBrand.includes(chain.keywords[0])) {
      return chain.name;
    }
  }

  if (lowerCity.includes('saint george') || lowerCity.includes('st george')) {
    return 'Walmart';
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

      const regularItem = suggestRegularItem(product.name);
      const suggestedRegularPrice = suggestRegularPrice(regularItem);

      currentItems = [{
        name: product.name,
        regularItem,
        price: 0,
        regularPrice: suggestedRegularPrice || 0,
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
      updateDeductibles();

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
    updateDeductibles();
  });

  function renderItems() {
    itemsContainer.innerHTML = '';
    currentItems.forEach((item, index) => {
      const block = document.createElement('div');
      block.className = 'item-block';
      block.innerHTML = `
        <h4>Item ${index + 1}</h4>
        
        <div class="form-field">
          <label>Item Name (Specialty)</label>
          <input type="text" value="${item.name}" data-index="${index}" class="name" placeholder="e.g. Great Value Quick Oats Gluten Free" />
        </div>
        
        <div class="form-field">
          <label>Specialty Price (in $)</label>
          <input type="number" step="0.01" value="${item.price || ''}" data-index="${index}" class="price" placeholder="e.g. 6.99" />
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
        
        <div class="form-field ${item.regularPrice ? '' : 'hidden'}">
          <label>Regular Price (USDA estimate in $)</label>
          <input type="number" step="0.01" value="${item.regularPrice || ''}" data-index="${index}" class="regular-price" readonly />
        </div>
        
        <div class="form-field ${item.deductible ? '' : 'hidden'}">
          <label>Deductible (extra amount in $)</label>
          <input type="number" step="0.01" value="${item.deductible || ''}" data-index="${index}" class="deductible" readonly />
        </div>
        
        <button class="remove-item" data-index="${index}">Remove Item</button>
      `;
      itemsContainer.appendChild(block);
    });

    // Event delegation - live update on input
    itemsContainer.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.matches('.price')) return;
      const idx = el.dataset.index;
      currentItems[idx].price = parseFloat(el.value) || 0;
      updateDeductibles();
    });

    itemsContainer.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.matches('.name, .category')) return;
      const idx = el.dataset.index;
      const key = el.className;
      currentItems[idx][key] = el.value;
      updateDeductibles();
    });

    itemsContainer.addEventListener('click', (e) => {
      if (!e.target.matches('.remove-item')) return;
      const idx = e.target.dataset.index;
      currentItems.splice(idx, 1);
      renderItems();
      updateDeductibles();
    });
  }

  // Update deductible calculation
  function updateDeductibles() {
    let totalDeduct = 0;
    let hasDeductible = false;

    currentItems.forEach((item, index) => {
      const deduct = (item.price || 0) - (item.regularPrice || 0);
      item.deductible = deduct > 0 ? deduct.toFixed(2) : '';
      totalDeduct += deduct > 0 ? deduct : 0;
      if (deduct > 0) hasDeductible = true;

      // Update visible fields
      const deductField = document.querySelector(`.deductible[data-index="${index}"]`);
      const deductContainer = deductField?.parentElement;
      if (deductContainer) {
        deductContainer.classList.toggle('hidden', !item.deductible);
        if (deductField) deductField.value = item.deductible;
      }
    });

    const summary = document.getElementById('deductible-summary');
    if (summary) {
      summary.style.display = hasDeductible ? 'block' : 'none';
      const totalSpan = document.getElementById('total-deductible');
      if (totalSpan) totalSpan.textContent = `$${totalDeduct.toFixed(2)}`;
    }
  }

  addItemBtn.addEventListener('click', () => {
    currentItems.push({ name: '', price: 0, regularPrice: 0, category: 'None', deductible: '' });
    renderItems();
    updateDeductibles();
  });

  saveReceiptBtn.addEventListener('click', async () => {
    currentDate = document.getElementById('receipt-date').value;
    currentLocation = document.getElementById('receipt-location').value;

    if (currentItems.length === 0) return alert('No items to save.');

    const receipt = {
      date: currentDate || new Date().toISOString().split('T')[0],
      location: currentLocation || 'Unknown Location',
      items: [...currentItems],
      createdAt: new Date().toISOString()
    };

    try {
      await db.put(STORE_NAME, receipt);
      alert('Receipt saved!');
      editSection.style.display = 'none';
      itemsContainer.innerHTML = '';
      document.getElementById('barcode-scan-btn').style.display = 'block';
      document.getElementById('manual-btn').style.display = 'block';
    } catch (err) {
      console.error('Save error:', err);
      alert('Error saving receipt. Check console.');
    }
  });

  cancelEditBtn.addEventListener('click', () => {
    editSection.style.display = 'none';
    itemsContainer.innerHTML = '';
    document.getElementById('barcode-scan-btn').style.display = 'block';
    document.getElementById('manual-btn').style.display = 'block';
  });
}

// History page logic
if (currentPage === 'history.html') {
  async function loadLogs() {
    const logList = document.getElementById('log-list');
    logList.innerHTML = '<p>Loading history...</p>';

    try {
      if (!db) {
        console.log('DB not ready – waiting...');
        await initDB();
      }

      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const all = await store.getAll();
      await tx.done;

      console.log('History loaded – receipts:', all.length, all);

      logList.innerHTML = all.length ? '' : '<p>No receipts logged yet.</p>';

      all.forEach(r => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.style.cursor = 'pointer';
        card.style.padding = '16px';
        card.style.background = 'white';
        card.style.borderRadius = '8px';
        card.style.marginBottom = '12px';
        card.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
        card.innerHTML = `
          <strong>${r.location || 'Unknown Location'} ${r.date}</strong><br>
          <small>${r.items.length} item(s) • Saved ${new Date(r.createdAt).toLocaleDateString()}</small>
        `;
        card.addEventListener('click', () => showReport(r));
        logList.appendChild(card);
      });
    } catch (err) {
      console.error('loadLogs error:', err);
      logList.innerHTML = '<p>Error loading history. Check console.</p>';
    }
  }

  function showReport(receipt) {
    const modal = document.getElementById('report-modal');
    const title = document.getElementById('report-title');
    const itemsDiv = document.getElementById('report-items');
    const totalDiv = document.getElementById('report-total');

    title.textContent = `${receipt.location || 'Unknown Location'} - ${receipt.date}`;
    itemsDiv.innerHTML = '';

    let totalDeduct = 0;
    receipt.items.forEach(i => {
      const deduct = parseFloat(i.deductible) || 0;
      totalDeduct += deduct;

      const itemLine = document.createElement('div');
      itemLine.className = 'report-item';
      itemLine.innerHTML = `
        <span>${i.name || 'Unnamed'} (${i.category || 'None'})</span>
        <span>$${parseFloat(i.price || 0).toFixed(2)}</span>
      `;
      itemsDiv.appendChild(itemLine);

      if (deduct > 0) {
        const deductLine = document.createElement('div');
        deductLine.className = 'report-item';
        deductLine.style.color = 'var(--accent)';
        deductLine.innerHTML = `
          <span>Deductible extra</span>
          <span>$${deduct.toFixed(2)}</span>
        `;
        itemsDiv.appendChild(deductLine);
      }
    });

    totalDiv.innerHTML = `Total potential deduction: $${totalDeduct.toFixed(2)}`;

    modal.style.display = 'flex';
  }

  document.getElementById('close-report')?.addEventListener('click', () => {
    document.getElementById('report-modal').style.display = 'none';
  });

  // Load on page load
  loadLogs();

  // Export CSV
  document.getElementById('export-csv')?.addEventListener('click', async () => {
    if (!db) await initDB();
    const tx = db.transaction(STORE_NAME);
    const store = tx.objectStore(STORE_NAME);
    const all = await store.getAll();
    if (!all.length) return alert('No data to export.');

    let csv = 'Date,Location,Item,Price,Category,Deductible\n';
    all.forEach(r => {
      r.items.forEach(i => {
        csv += `"${r.date}","${r.location}","${i.name.replace(/"/g,'""')}","${i.price}","${i.category}","${i.deductible || ''}"\n`;
      });
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deducteats_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
}
