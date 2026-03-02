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

  // Scan Receipt - open file picker
  document.getElementById('scan-btn')?.addEventListener('click', () => {
    console.log('Scan button clicked – opening file picker');
    document.getElementById('file-input').click();
  });

  // Handle file selection + preview
  document.getElementById('file-input')?.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length === 0) return;

    const previewContainer = document.getElementById('preview-container');
    const imagePreview = document.getElementById('image-preview');
    imagePreview.innerHTML = ''; // Clear previous previews

    previewContainer.style.display = 'block';

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return; // Skip non-images

      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.maxWidth = '180px';
      img.style.borderRadius = '8px';
      img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
      img.style.objectFit = 'cover';
      imagePreview.appendChild(img);
    });

    console.log(`Selected ${files.length} image(s) for processing`);
  });

  // Process button – run basic OCR
  document.getElementById('process-images')?.addEventListener('click', async () => {
    const files = document.getElementById('file-input').files;
    if (files.length === 0) return alert('No images selected.');

    const ocrResultDiv = document.getElementById('ocr-result');
    const ocrTextDiv = document.getElementById('ocr-text');
    ocrResultDiv.style.display = 'block';
    ocrTextDiv.innerHTML = 'Starting OCR... (this may take 5–60 seconds per image)<br>';

    let combinedText = '';

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        ocrTextDiv.innerHTML += `<br>Processing image ${i+1}/${files.length}: ${file.name}<br>`;

        const { data: { text } } = await Tesseract.recognize(
          file,
          'eng',
          {
            logger: m => console.log(m), // Progress in console
          }
        );

        combinedText += `\n\n--- Image ${i+1}: ${file.name} ---\n${text.trim()}\n`;
        ocrTextDiv.innerHTML += `Done. Extracted ${text.length} characters.<br>`;
      }

      ocrTextDiv.innerHTML = combinedText || 'No readable text could be extracted from the images.';
      alert('OCR complete! Raw extracted text is shown below.');
    } catch (err) {
      console.error('OCR error:', err);
      ocrTextDiv.innerHTML = 'OCR failed. Error: ' + err.message;
      alert('OCR failed. Check console for details.');
    }
  });

  // Manual entry logic
  const manualBtn = document.getElementById('manual-btn');
  const editSection = document.getElementById('edit-section');
  const itemsContainer = document.getElementById('items-container');
  const addItemBtn = document.getElementById('add-item-btn');
  const saveReceiptBtn = document.getElementById('save-receipt');
  const cancelEditBtn = document.getElementById('cancel-edit');

  manualBtn.addEventListener('click', () => {
    currentItems = [];
    currentDate = new Date().toISOString().split('T')[0];
    currentLocation = '';
    editSection.style.display = 'block';
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
    } catch (err) {
      console.error('Save error:', err);
      alert('Error saving receipt. Check console.');
    }
  });

  cancelEditBtn.addEventListener('click', () => {
    editSection.style.display = 'none';
    itemsContainer.innerHTML = '';
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