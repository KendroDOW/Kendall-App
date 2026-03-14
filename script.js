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

// ... (keep all your existing functions: lookupProductByBarcode, suggestCategory, convertToLb, suggestRegularItem, suggestRegularPrice, getCurrentLocation, suggestStoreName, checkLogin, etc. unchanged)

// Page detection
const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
const filename = path.split('/').pop() || '';

const isHomePage = filename === 'home.html' || filename === 'index.html' || path === '' || path.includes('home');
const isHistoryPage = filename === 'history.html' || path.includes('history');

// Global attachPhotos (capture modal - adds photos)
async function attachPhotos(receiptId) {
  let photos = []; // array of base64 strings

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

// New: View existing photos
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
  // ... (keep your existing home page code: scanBtn, manualBtn, renderItems, updateDeductibles, addItemBtn, saveReceiptBtn, cancelEditBtn unchanged)
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
