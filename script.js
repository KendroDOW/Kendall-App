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

// USDA average regular prices (per lb or unit, approximate values)
const usdaRegularPrices = {
  'oats': 0.55,
  'flour': 0.50,
  'bread': 1.60,
  'pasta': 1.20,
  'sugar': 0.80,
  'soup': 1.50,
};

// Lookup product by barcode using Open Food Facts API
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
      return {
        name: product.product_name || product.generic_name || 'Unknown Product',
        brand: product.brands || '',
        categoryTags: product.categories_tags || product.categories || [],
        quantity,
      };
    } else {
      return { name: 'Product Not Found', brand: '', categoryTags: [], quantity: '' };
    }
  } catch (err) {
    console.error('Product lookup error:', err);
    return { name: 'Error Looking Up Product', brand: '', categoryTags: [], quantity: '' };
  }
}

// Category suggestion based on keywords in name or tags
function suggestCategory(tags, itemName = '') {
  const allText = [
    ...(tags || []).join(' ').toLowerCase(),
    (itemName || '').toLowerCase()
  ].join(' ');

  if (allText.includes('gluten-free') || allText.includes('gluten free')) {
    return 'Gluten-Free';
  }
  if (allText.includes('keto') || allText.includes('low-carb') || allText.includes('low carb')) {
    return 'Keto';
  }
  if (allText.includes('low-sodium') || allText.includes('low sodium') || 
      allText.includes('reduced sodium') || allText.includes('low salt') || 
      allText.includes('reduced salt')) {
    return 'Low-Sodium';
  }
  if (allText.includes('vegan') || allText.includes('plant-based')) {
    return 'Vegan';
  }

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
  if (!itemName) return '';

  const lowerName = itemName.toLowerCase();

  if (lowerName.includes('oat') || lowerName.includes('oats')) {
    return 'oats';
  }
  if (lowerName.includes('flour')) return 'flour';
  if (lowerName.includes('bread')) return 'bread';
  if (lowerName.includes('pasta')) return 'pasta';
  if (lowerName.includes('sugar') || lowerName.includes('sweetener')) return 'sugar';
  if (lowerName.includes('soup')) return 'soup';

  return '';
}

// Suggest regular price from USDA table
function suggestRegularPrice(regularItem) {
  if (!regularItem) return null;
  const lowerItem = regularItem.toLowerCase();
  for (const [key, price] of Object.entries(usdaRegularPrices)) {
    if (lowerItem.includes(key)) {
      return price;
    }
  }
  return null;
}

// Get approximate location
async function getCurrentLocation() {
  if (!navigator.geolocation) return 'Unknown Location';

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

// Suggest store name
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
    if (lowerBrand.includes(chain.keywords[0])) return chain.name;
  }

  if (lowerCity.includes('saint george') || lowerCity.includes('st george')) return 'Walmart';

  return `${city} Grocery Store`;
}

// Login from welcome page
document.getElementById('start-login-btn')?.addEventListener('click', () => {
  console.log('Login button clicked');
  localStorage.setItem('deductEatsLoggedIn', 'true');
  window.location.href = 'home.html';
});

// Login state check
function checkLogin() {
  if (!localStorage.getItem('deductEatsLoggedIn')) {
    window.location.href = 'welcome.html';
  }
}

// Run login check on protected pages
const currentPath = window.location.pathname.toLowerCase();
if (!currentPath.endsWith('welcome.html') && !currentPath.endsWith('/')) {
  checkLogin();
}

// Logout
document.getElementById('logout-btn')?.addEventListener('click', () => {
  if (confirm("Log out?")) {
    localStorage.removeItem('deductEatsLoggedIn');
    window.location.href = 'welcome.html';
  }
});

// Page detection
const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
const filename = path.split('/').pop() || '';

const isHomePage = filename === 'home.html' || filename === 'index.html' || path === '' || path.includes('home');
const isHistoryPage = filename === 'history.html' || path.includes('history');

// Global attachPhotos function (capture modal)
async function attachPhotos(receiptId) {
  let photos = [];

  const modal = document.getElementById('photo-capture-modal');
  const preview = document.getElementById('photo-preview');
  const status = document.getElementById('photo-status');
  const takeBtn = document.getElementById('take-photo-btn');
  const saveBtn = document.getElementById('save-photos-btn');
  const cancelBtn = document.getElementById('cancel-photos-btn');
  const input = document.getElementById('hidden-camera-input');

  if (!modal || !input) {
    console.error('Photo modal or input missing');
    alert('Photo capture not available.');
    return;
  }

  // Reset
  photos = [];
  preview.innerHTML = '<p style="color:#666;">No photo yet</p>';
  status.textContent = 'Take a photo of your receipt (up to 3)';
  saveBtn.disabled = true;
  takeBtn.disabled = false;
  takeBtn.textContent = 'Take Photo';

  modal.style.display = 'flex';

  // Take Photo handler
  const takeHandler = () => {
    input.value = '';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      console.log('Photo selected, size:', file.size);

      try {
        const img = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxSize = 1024;
        let w = img.width;
        let h = img.height;

        if (w > h) {
          if (w > maxSize) { h *= maxSize / w; w = maxSize; }
        } else {
          if (h > maxSize) { w *= maxSize / h; h = maxSize; }
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        photos.push(dataUrl);

        preview.innerHTML = `<img src="${dataUrl}" style="max-width:100%; max-height:180px; border-radius:8px;">`;
        status.textContent = `Photo ${photos.length} added (up to 3)`;
        saveBtn.disabled = false;

        if (photos.length >= 3) {
          takeBtn.disabled = true;
          takeBtn.textContent = 'Max reached';
        }
      } catch (err) {
        console.error('Photo processing error:', err);
        alert('Error processing photo.');
      }
    };

    input.click();
  };

  takeBtn.onclick = takeHandler;

  // Save handler
  saveBtn.onclick = async () => {
    if (photos.length === 0) return alert('No photos to save.');
    try {
      await savePhotos(receiptId, photos);
      alert('Photos saved successfully!');
      modal.style.display = 'none';
    } catch (err) {
      console.error('Save failed:', err);
      alert('Error saving photos.');
    }
  };

  // Cancel handler
  cancelBtn.onclick = () => {
    modal.style.display = 'none';
  };
}

// Save photos as base64 strings
async function savePhotos(receiptId, photos) {
  try {
    console.log('Saving photos for receipt ID:', receiptId);
    console.log('Number of photos:', photos.length);

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const receipt = await store.get(receiptId);
    if (!receipt) {
      console.error('Receipt not found:', receiptId);
      alert('Receipt not found.');
      return;
    }

    receipt.photos = receipt.photos ? receipt.photos.concat(photos) : photos;
    console.log('Updated receipt photos length:', receipt.photos.length);

    await store.put(receipt);
    await tx.done;
    console.log('Photos saved successfully to receipt:', receiptId);
  } catch (err) {
    console.error('Save photos error:', err);
    alert('Error saving photos. Check console.');
  }
}

// View existing photos
async function viewPhotos(receiptId) {
  const modal = document.getElementById('photo-viewer-modal');
  const gallery = document.getElementById('viewer-gallery');
  gallery.innerHTML = '<p>Loading photos...</p>';

  if (!modal) {
    console.error('Viewer modal not found');
    alert('Viewer not available.');
    return;
  }

  try {
    const receipt = await db.transaction(STORE_NAME).objectStore(STORE_NAME).get(receiptId);
    gallery.innerHTML = '';

    if (!receipt || !receipt.photos || receipt.photos.length === 0) {
      gallery.innerHTML = '<p>No photos saved for this receipt.</p>';
      modal.style.display = 'flex';
      return;
    }

    receipt.photos.forEach((dataUrl) => {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.maxWidth = '200px';
      img.style.margin = '8px';
      img.style.borderRadius = '8px';
      img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
      gallery.appendChild(img);
    });

    modal.style.display = 'flex';
  } catch (err) {
    console.error('View photos error:', err);
    gallery.innerHTML = '<p>Error loading photos.</p>';
    modal.style.display = 'flex';
  }
}

// Home page logic
if (isHomePage) {
  let currentItems = [];
  let currentDate = '';
  let currentLocation = '';

  const scanBtn = document.getElementById('barcode-scan-btn');
  const manualBtn = document.getElementById('manual-btn');
  const addItemBtn = document.getElementById('add-item-btn');
  const saveReceiptBtn = document.getElementById('save-receipt');
  const cancelEditBtn = document.getElementById('cancel-edit');
  const itemsContainer = document.getElementById('items-container');
  const editSection = document.getElementById('edit-section');

  let barcodeScannerActive = false;

  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      const previewContainer = document.getElementById('barcode-preview-container');
      previewContainer.style.display = 'flex';
      barcodeScannerActive = true;

      const mainNav = document.getElementById('top-nav');
      if (mainNav) mainNav.style.display = 'none';

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
          console.error('Quagga init failed:', err);
          alert('Camera failed to start: ' + (err.name || 'Unknown error') + ' - ' + (err.message || ''));
          previewContainer.style.display = 'none';
          barcodeScannerActive = false;
          if (mainNav) mainNav.style.display = 'flex';
          return;
        }
        console.log('Quagga started successfully');
        Quagga.start();
      });

      Quagga.onProcessed((result) => {
        // console.log('Frame processed');
      });

      Quagga.onDetected(async (result) => {
        const code = result.codeResult.code;
        Quagga.stop();
        previewContainer.style.display = 'none';
        barcodeScannerActive = false;
        if (mainNav) mainNav.style.display = 'flex';

        const product = await lookupProductByBarcode(code);

        if (product.name === 'Product Not Found' || product.name === 'Error Looking Up Product') {
          alert('Barcode scanned: ' + code + '\nProduct not found.\nEnter name manually.');
        } else {
          alert('Found: ' + product.name + '\nQuantity: ' + (product.quantity || 'Not found'));
        }

        const regularItem = suggestRegularItem(product.name);
        const suggestedRegularPrice = suggestRegularPrice(regularItem);

        currentItems = [{
          name: product.name,
          price: 0,
          regularPrice: suggestedRegularPrice || 0,
          category: suggestCategory(product.categoryTags, product.name),
          deductible: '',
          quantity: product.quantity || ''
        }];

        currentLocation = suggestStoreName(cityFromGeo, product.brand);
        currentDate = new Date().toISOString().split('T')[0];

        editSection.style.display = 'block';
        scanBtn.style.display = 'none';
        manualBtn.style.display = 'none';
        document.getElementById('receipt-location').value = currentLocation;
        document.getElementById('receipt-date').value = currentDate;
        renderItems();
        updateDeductibles();

        document.querySelector('.price')?.focus();
      });
    });
  }

  if (manualBtn) {
    manualBtn.addEventListener('click', async () => {
      currentItems = [];
      currentDate = new Date().toISOString().split('T')[0];
      const cityFromGeo = await getCurrentLocation();
      currentLocation = suggestStoreName(cityFromGeo);
      editSection.style.display = 'block';
      scanBtn.style.display = 'none';
      manualBtn.style.display = 'none';
      document.getElementById('receipt-location').value = currentLocation;
      document.getElementById('receipt-date').value = currentDate;
      renderItems();
      updateDeductibles();
    });
  }

  function renderItems() {
    itemsContainer.innerHTML = '';
    currentItems.forEach((item, index) => {
      const hasRegularPrice = item.regularPrice > 0;
      const hasQuantity = !!item.quantity;
      const hasDeductible = item.deductible !== '' && parseFloat(item.deductible) > 0;

      const block = document.createElement('div');
      block.className = 'item-block';
      block.innerHTML = `
        <h4>Item ${index + 1}</h4>
        
        <div class="form-field">
          <label>Item Name</label>
          <input type="text" value="${item.name}" data-index="${index}" class="name" placeholder="e.g. Great Value Quick Oats Gluten Free" />
        </div>
        
        <div class="form-field ${hasQuantity ? '' : 'hidden'}">
          <label>Net Weight / Quantity</label>
          <input type="text" value="${item.quantity}" data-index="${index}" class="quantity" />
        </div>
        
        <div class="form-field">
          <label>Price (total for item)</label>
          <div class="input-with-dollar">
            <span class="dollar-sign">$</span>
            <input type="number" step="0.01" value="${item.price || ''}" data-index="${index}" class="price" placeholder="e.g. 6.99" />
          </div>
        </div>
        
        <div class="form-field ${hasRegularPrice ? '' : 'hidden'}">
          <label>USDA Avg Regular Price (per lb)</label>
          <input type="number" step="0.01" value="${item.regularPrice || ''}" data-index="${index}" class="regular-price" readonly />
        </div>
        
        <div class="form-field">
          <label>Category</label>
          <select data-index="${index}" class="category">
            <option value="None" ${item.category==='None'?'selected':''}>None</option>
            <option value="Gluten-Free" ${item.category==='Gluten-Free'?'selected':''}>Gluten-Free</option>
            <option value="Keto" ${item.category==='Keto'?'selected':''}>Keto</option>
            <option value="Low-Sodium" ${item.category==='Low-Sodium'?'selected':''}>Low-Sodium</option>
            <option value="Other" ${item.category==='Other'?'selected':''}>Other</option>
          </select>
        </div>
        
        <div class="form-field ${hasDeductible ? '' : 'hidden'}">
          <label>Estimated Deductible (based on USDA averages)</label>
          <input type="number" step="0.01" value="${item.deductible || ''}" data-index="${index}" class="deductible" readonly />
        </div>
        
        <button class="remove-item" data-index="${index}">Remove Item</button>
      `;
      itemsContainer.appendChild(block);
    });

    itemsContainer.addEventListener('input', (e) => {
      const el = e.target;
      const idx = el.dataset.index;

      if (el.matches('.price')) {
        currentItems[idx].price = parseFloat(el.value) || 0;
        updateDeductibles();
      } else if (el.matches('.name')) {
        currentItems[idx].name = el.value;
        const regularItem = suggestRegularItem(el.value);
        currentItems[idx].regularPrice = suggestRegularPrice(regularItem) || 0;
        currentItems[idx].category = suggestCategory([], el.value);

        const itemBlock = el.closest('.item-block');
        if (itemBlock) {
          const usdaInput = itemBlock.querySelector('.regular-price');
          if (usdaInput) {
            usdaInput.value = currentItems[idx].regularPrice;
            usdaInput.parentElement.classList.toggle('hidden', !currentItems[idx].regularPrice);
          }
          const categorySelect = itemBlock.querySelector('.category');
          if (categorySelect) {
            categorySelect.value = currentItems[idx].category;
          }
        }

        updateDeductibles();
      } else if (el.matches('.quantity')) {
        currentItems[idx].quantity = el.value;
        updateDeductibles();
      }
    });

    itemsContainer.addEventListener('change', (e) => {
      const el = e.target;
      if (el.matches('.category')) {
        const idx = el.dataset.index;
        currentItems[idx].category = el.value;
        updateDeductibles();
      }
    });

    itemsContainer.addEventListener('click', (e) => {
      if (e.target.matches('.remove-item')) {
        const idx = e.target.dataset.index;
        currentItems.splice(idx, 1);
        renderItems();
        updateDeductibles();
      }
    });
  }

  function updateDeductibles() {
    let totalDeduct = 0;
    let hasDeductible = false;

    currentItems.forEach((item, index) => {
      let deduct = 0;

      if (item.regularPrice > 0) {
        if (item.quantity) {
          const qtyInLb = convertToLb(item.quantity);
          if (qtyInLb > 0) {
            const specialtyTotal = item.price || 0;
            const regularTotal = item.regularPrice * qtyInLb;
            deduct = specialtyTotal - regularTotal;
          } else {
            deduct = (item.price || 0) - item.regularPrice;
          }
        } else {
          deduct = (item.price || 0) - item.regularPrice;
        }

        item.deductible = deduct > 0 ? deduct.toFixed(2) : '0.00';
        totalDeduct += deduct > 0 ? deduct : 0;
        if (deduct > 0) hasDeductible = true;
      } else {
        item.deductible = '0.00';
      }

      const deductInput = document.querySelector(`.deductible[data-index="${index}"]`);
      if (deductInput) {
        deductInput.value = item.deductible;
        deductInput.parentElement.classList.toggle('hidden', item.deductible === '0.00');
      }
    });

    const summary = document.getElementById('deductible-summary');
    if (summary) {
      summary.style.display = hasDeductible ? 'block' : 'none';
      const totalSpan = document.getElementById('total-deductible');
      if (totalSpan) totalSpan.textContent = `$${totalDeduct.toFixed(2)}`;
    }
  }

  if (addItemBtn) {
    addItemBtn.addEventListener('click', () => {
      currentItems.push({ name: '', price: 0, regularPrice: 0, category: 'None', deductible: '', quantity: '' });
      renderItems();
      updateDeductibles();
    });
  }

  if (saveReceiptBtn) {
    saveReceiptBtn.addEventListener('click', async () => {
      currentDate = document.getElementById('receipt-date').value;
      currentLocation = document.getElementById('receipt-location').value;

      if (currentItems.length === 0) return alert('No items to save.');

      let totalDeduct = 0;
      currentItems.forEach(item => {
        if (item.regularPrice > 0) {
          let deduct = 0;
          if (item.quantity) {
            const qtyInLb = convertToLb(item.quantity);
            if (qtyInLb > 0) {
              const specialtyTotal = item.price || 0;
              const regularTotal = item.regularPrice * qtyInLb;
              deduct = specialtyTotal - regularTotal;
            } else {
              deduct = (item.price || 0) - item.regularPrice;
            }
          } else {
            deduct = (item.price || 0) - item.regularPrice;
          }
          totalDeduct += deduct > 0 ? deduct : 0;
        }
      });

      const receipt = {
        date: currentDate || new Date().toISOString().split('T')[0],
        location: currentLocation || 'Unknown Location',
        items: [...currentItems],
        createdAt: new Date().toISOString(),
        photos: [],
        totalDeductible: totalDeduct
      };

      try {
        const key = await db.put(STORE_NAME, receipt);
        alert('Receipt saved!');

        if (confirm('Attach photo?')) {
          attachPhotos(key);
        }

        editSection.style.display = 'none';
        itemsContainer.innerHTML = '';
        document.getElementById('barcode-scan-btn').style.display = 'block';
        document.getElementById('manual-btn').style.display = 'block';
      } catch (err) {
        console.error('Save error:', err);
        alert('Error saving receipt. Check console.');
      }
    });
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
      editSection.style.display = 'none';
      itemsContainer.innerHTML = '';
      document.getElementById('barcode-scan-btn').style.display = 'block';
      document.getElementById('manual-btn').style.display = 'block';
    });
  }
}

// History page logic
if (isHistoryPage) {
  async function loadLogs() {
    const logList = document.getElementById('log-list');
    if (!logList) return;
    logList.innerHTML = '<p>Loading history...</p>';

    try {
      if (!db) await initDB();

      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const all = await store.getAll();
      await tx.done;

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

        const photoCount = r.photos ? r.photos.length : 0;
        const addIcon = '+';
        const cameraIcon = photoCount > 0 ? '📷' : '';
        const eyeIcon = photoCount > 0 ? '👁️' : '';
        const badge = photoCount > 0 ? `<span style="background:#1976d2;color:white;border-radius:50%;padding:2px 8px;font-size:0.8rem;">${photoCount}</span>` : '';

        card.innerHTML = `
          <strong>${r.location || 'Unknown Location'} - ${r.date}</strong><br>
          <small>${r.items.length} item(s) • Deductible: $${r.totalDeductible?.toFixed(2) || '0.00'}</small>
          <div style="margin-top:8px; cursor:pointer;">
            <span class="photo-icon" title="Add receipt photo" onclick="event.stopPropagation(); attachPhotos(${r.id})">${addIcon}</span>
            ${badge}
            ${cameraIcon ? `<span class="photo-icon" title="Add more photos" onclick="event.stopPropagation(); attachPhotos(${r.id})">${cameraIcon}</span>` : ''}
            ${eyeIcon ? `<span class="photo-icon" title="View receipt photos" onclick="event.stopPropagation(); viewPhotos(${r.id})">${eyeIcon}</span>` : ''}
          </div>
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
    if (!modal) return;

    const title = document.getElementById('report-title');
    const itemsDiv = document.getElementById('report-items');
    const totalDiv = document.getElementById('report-total');

    title.textContent = `${receipt.location || 'Unknown'} - ${receipt.date}`;
    itemsDiv.innerHTML = '';

    let totalDeduct = 0;
    receipt.items.forEach(i => {
      const deduct = parseFloat(i.deductible) || 0;
      totalDeduct += deduct;

      itemsDiv.innerHTML += `
        <div class="report-item">
          <span>${i.name || 'Unnamed'} (${i.category || 'None'})</span>
          <span>$${parseFloat(i.price || 0).toFixed(2)}</span>
        </div>
      `;

      if (deduct > 0) {
        itemsDiv.innerHTML += `
          <div class="report-item" style="color:#1976d2;">
            <span>Deductible extra</span>
            <span>$${deduct.toFixed(2)}</span>
          </div>
        `;
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
