/**
 * Panel de Administración del Catálogo
 * - Protección por Clave de Acceso (por defecto: admin123)
 * - Sincronización en la nube con Supabase (para que se vea en todos los celulares y PC)
 * - Subida, Edición y Eliminación de Productos
 * - Gestión de Fotos con Compresión Automática
 */

// 1. Inicialización de Supabase con limpieza automática de URL
const rawUrl = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL.trim() : '';
const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const isSupabaseActive = typeof supabase !== 'undefined' &&
  cleanUrl.startsWith('https://') &&
  !cleanUrl.includes('TU-PROYECTO');

const supabaseClient = isSupabaseActive ? supabase.createClient(cleanUrl, SUPABASE_ANON_KEY.trim()) : null;

// Claves de autenticación local
const PASS_STORAGE_KEY = 'catalogo_admin_pass';
const SESSION_AUTH_KEY = 'catalogo_admin_authenticated';
const DEFAULT_PASS = 'admin123';

// Base de Datos IndexedDB (Fallback y caché)
const DB_NAME = 'CatalogoSimpleDB';
const DB_VERSION = 1;
const STORE_NAME = 'productos';

let db = null;
let products = [];
let currentImageBase64 = '';
let isEditing = false;

function cleanWhatsappPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';

  while (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length === 10) {
    digits = '549' + digits;
  } else if (digits.length === 12 && digits.startsWith('54') && !digits.startsWith('549')) {
    digits = '549' + digits.slice(2);
  }

  return digits;
}

const globalPhone = (typeof STORE_WHATSAPP_PHONE !== 'undefined' && STORE_WHATSAPP_PHONE) ? STORE_WHATSAPP_PHONE : '';

const defaultSettings = {
  storeName: 'Mi Catálogo',
  storeSubtitle: 'Catálogo de productos disponibles',
  currency: '$',
  whatsappPhone: globalPhone
};
let settings = { ...defaultSettings };

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

function dbPut(product) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(product);
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(product);
    request.onsuccess = () => resolve(product);
    request.onerror = (e) => reject(e.target.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(id);
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve(id);
    request.onerror = (e) => reject(e.target.error);
  });
}

function dbClear() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

function notifyUpdate() {
  localStorage.setItem('catalogo_last_updated_time', Date.now().toString());
}

// Elementos DOM
const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const loginForm = document.getElementById('loginForm');
const passwordInput = document.getElementById('passwordInput');
const btnTogglePassword = document.getElementById('btnTogglePassword');
const loginErrorMsg = document.getElementById('loginErrorMsg');

const adminStoreTitle = document.getElementById('adminStoreTitle');
const btnOpenSettings = document.getElementById('btnOpenSettings');
const btnLogout = document.getElementById('btnLogout');

const productManageForm = document.getElementById('productManageForm');
const formActionTitle = document.getElementById('formActionTitle');
const editProductId = document.getElementById('editProductId');
const inputName = document.getElementById('inputName');
const inputPrice = document.getElementById('inputPrice');
const inputCategory = document.getElementById('inputCategory');
const inputDescription = document.getElementById('inputDescription');
const adminCurrencyBadge = document.getElementById('adminCurrencyBadge');
const categoriesDatalist = document.getElementById('categoriesDatalist');
const btnSubmitProduct = document.getElementById('btnSubmitProduct');
const btnSubmitText = document.getElementById('btnSubmitText');
const btnCancelEdit = document.getElementById('btnCancelEdit');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabUploadContent = document.getElementById('tabUploadContent');
const tabUrlContent = document.getElementById('tabUrlContent');
const dropZone = document.getElementById('dropZone');
const imageFileInput = document.getElementById('imageFileInput');
const imageUrlInput = document.getElementById('imageUrlInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const btnRemoveImage = document.getElementById('btnRemoveImage');

const adminProductsList = document.getElementById('adminProductsList');
const uploadedCountSubtitle = document.getElementById('uploadedCountSubtitle');

const settingsDialog = document.getElementById('settingsDialog');
const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal');
const btnCancelSettings = document.getElementById('btnCancelSettings');
const settingsForm = document.getElementById('settingsForm');
const storeNameInput = document.getElementById('storeNameInput');
const storeSubtitleInput = document.getElementById('storeSubtitleInput');
const currencyInput = document.getElementById('currencyInput');
const whatsappPhoneInput = document.getElementById('whatsappPhoneInput');
const newPasswordInput = document.getElementById('newPasswordInput');
const confirmPasswordInput = document.getElementById('confirmPasswordInput');
const btnExportBackup = document.getElementById('btnExportBackup');
const backupFileInput = document.getElementById('backupFileInput');
const btnResetDemoData = document.getElementById('btnResetDemoData');

const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Autenticación
function getStoredPassword() {
  return localStorage.getItem(PASS_STORAGE_KEY) || DEFAULT_PASS;
}

function isAuthenticated() {
  return sessionStorage.getItem(SESSION_AUTH_KEY) === 'true';
}

function setAuthenticated(status) {
  if (status) {
    sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
  } else {
    sessionStorage.removeItem(SESSION_AUTH_KEY);
  }
}

function checkAccess() {
  if (isAuthenticated()) {
    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    loadDashboardData();
  } else {
    loginSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    passwordInput.value = '';
    passwordInput.focus();
  }
}

function handleLogin(e) {
  e.preventDefault();
  const enteredPass = passwordInput.value;
  const currentPass = getStoredPassword();

  if (enteredPass === currentPass) {
    loginErrorMsg.classList.add('hidden');
    setAuthenticated(true);
    checkAccess();
    showToast('¡Bienvenido al Panel de Administración!');
  } else {
    loginErrorMsg.classList.remove('hidden');
    passwordInput.select();
  }
}

function handleLogout() {
  setAuthenticated(false);
  checkAccess();
  showToast('Sesión cerrada');
}

// Carga de datos
async function loadDashboardData() {
  loadSettings();
  applySettings();

  try {
    await initDB();
  } catch (e) {
    console.warn('DB local:', e);
  }

  await refreshAdminList();
}

async function refreshAdminList() {
  if (supabaseClient) {
    try {
      let allData = [];
      let from = 0;
      const step = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabaseClient
          .from('productos_catalogo')
          .select('*')
          .range(from, from + step - 1)
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (data && data.length > 0) {
          allData = allData.concat(data);
          from += step;
          if (data.length < step) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      products = allData.map(item => ({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        category: item.category,
        description: item.description,
        image: item.image,
        createdAt: Number(item.created_at)
      }));
    } catch (err) {
      console.error('Error al leer de Supabase:', err);
      products = await dbGetAll();
    }
  } else {
    products = await dbGetAll();
  }

  renderAdminProductsList();
  updateCategoryDatalist();
}

function loadSettings() {
  const globalPhone = (typeof STORE_WHATSAPP_PHONE !== 'undefined' && STORE_WHATSAPP_PHONE) ? STORE_WHATSAPP_PHONE : '';
  const saved = localStorage.getItem('catalogo_config');
  if (saved) {
    try {
      settings = { ...defaultSettings, ...JSON.parse(saved) };
      if (!settings.whatsappPhone && globalPhone) {
        settings.whatsappPhone = globalPhone;
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    settings = { ...defaultSettings, whatsappPhone: globalPhone };
  }
}

function saveSettings() {
  localStorage.setItem('catalogo_config', JSON.stringify(settings));
  notifyUpdate();
  applySettings();
}

function applySettings() {
  adminStoreTitle.textContent = settings.storeName || 'Panel de Administración';
  adminCurrencyBadge.textContent = settings.currency || '$';
}

function formatPrice(amount) {
  const symbol = settings.currency || '$';
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return 'Consultar precio';
  return `${symbol} ${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderAdminProductsList() {
  adminProductsList.innerHTML = '';
  uploadedCountSubtitle.textContent = `${products.length} ${products.length === 1 ? 'producto en total' : 'productos en total'}${supabaseClient ? ' (Sincronizado con Supabase ☁️)' : ''}`;

  if (products.length === 0) {
    adminProductsList.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted); font-size: 0.9rem;">
        Aún no has subido productos. Completa el formulario de la izquierda para agregar tu primer producto.
      </div>
    `;
    return;
  }

  const sorted = [...products].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  sorted.forEach(p => {
    const item = document.createElement('div');
    item.className = 'uploaded-item';
    if (editProductId.value === p.id) {
      item.style.borderColor = 'var(--primary)';
      item.style.backgroundColor = 'var(--primary-light)';
    }

    const placeholderImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60" fill="%23cbd5e1"><rect width="60" height="60"/></svg>';
    const imgSrc = p.image || placeholderImg;

    item.innerHTML = `
      <img src="${imgSrc}" class="uploaded-thumb" alt="${escapeHTML(p.name)}" onerror="this.src='${placeholderImg}'">
      <div class="uploaded-info">
        <h4 class="uploaded-title" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</h4>
        <div class="uploaded-meta">
          <span class="uploaded-price">${formatPrice(p.price)}</span>
          <span class="uploaded-category">${escapeHTML(p.category || 'General')}</span>
        </div>
      </div>
      <div class="uploaded-actions">
        <button type="button" class="btn-item-action" onclick="startEditProduct('${p.id}')" title="Editar producto">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button type="button" class="btn-item-action delete" onclick="handleDeleteProduct('${p.id}')" title="Eliminar producto">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    adminProductsList.appendChild(item);
  });
}

function updateCategoryDatalist() {
  const categories = new Set();
  products.forEach(p => {
    if (p.category && p.category.trim()) {
      categories.add(p.category.trim());
    }
  });

  const sortedCategories = Array.from(categories).sort((a, b) => a.localeCompare(b));
  categoriesDatalist.innerHTML = sortedCategories.map(c => `<option value="${escapeHTML(c)}">`).join('');
}

function startEditProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  isEditing = true;
  editProductId.value = product.id;
  inputName.value = product.name || '';
  inputPrice.value = product.price || '';
  inputCategory.value = product.category || '';
  inputDescription.value = product.description || '';

  formActionTitle.textContent = `✏️ Editando: ${product.name}`;
  btnSubmitText.textContent = 'Guardar Cambios';
  btnCancelEdit.classList.remove('hidden');

  currentImageBase64 = product.image || '';
  if (currentImageBase64) {
    imagePreview.src = currentImageBase64;
    imagePreviewContainer.classList.remove('hidden');
    if (currentImageBase64.startsWith('http')) {
      imageUrlInput.value = currentImageBase64;
      setActiveTab('url');
    } else {
      setActiveTab('upload');
    }
  } else {
    imagePreviewContainer.classList.add('hidden');
    setActiveTab('upload');
  }

  productManageForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  inputName.focus();
  renderAdminProductsList();
}

function cancelEdit() {
  isEditing = false;
  editProductId.value = '';
  productManageForm.reset();
  currentImageBase64 = '';
  imagePreview.src = '';
  imagePreviewContainer.classList.add('hidden');
  formActionTitle.textContent = '📤 Subir Nuevo Producto';
  btnSubmitText.textContent = 'Publicar en el Catálogo';
  btnCancelEdit.classList.add('hidden');
  setActiveTab('upload');
  renderAdminProductsList();
}

async function handleProductSubmit(e) {
  e.preventDefault();

  const name = inputName.value.trim();
  const price = parseFloat(inputPrice.value);
  const category = inputCategory.value.trim();
  const description = inputDescription.value.trim();
  const id = editProductId.value || `prod-${Date.now()}`;

  if (!name) {
    showToast('Por favor escribe el nombre del producto');
    return;
  }

  if (isNaN(price) || price < 0) {
    showToast('Ingresa un precio válido');
    return;
  }

  let finalImage = currentImageBase64;
  if (!finalImage && imageUrlInput.value.trim()) {
    finalImage = imageUrlInput.value.trim();
  }

  const existingIndex = products.findIndex(p => p.id === id);
  const existingProduct = existingIndex >= 0 ? products[existingIndex] : null;

  const productObj = {
    id: id,
    name: name,
    price: price,
    category: category,
    description: description,
    image: finalImage,
    createdAt: existingProduct ? existingProduct.createdAt : Date.now(),
    updatedAt: Date.now()
  };

  btnSubmitProduct.disabled = true;
  showToast('Guardando producto...');

  try {
    if (supabaseClient) {
      const { error } = await supabaseClient
        .from('productos_catalogo')
        .upsert([{
          id: productObj.id,
          name: productObj.name,
          price: productObj.price,
          category: productObj.category,
          description: productObj.description,
          image: productObj.image,
          created_at: productObj.createdAt
        }]);

      if (error) throw error;
      showToast('¡Guardado en la nube de Supabase! ☁️');
    } else {
      showToast('¡Guardado localmente!');
    }

    await dbPut(productObj);
    notifyUpdate();

    cancelEdit();
    await refreshAdminList();
  } catch (error) {
    console.error('Error al guardar:', error);
    alert('Error al guardar en Supabase: ' + (error.message || error));
  } finally {
    btnSubmitProduct.disabled = false;
  }
}

async function handleDeleteProduct(id) {
  const p = products.find(x => x.id === id);
  const name = p ? p.name : 'este producto';

  const confirmDelete = window.confirm(`¿Seguro que deseas eliminar "${name}" del catálogo?`);
  if (!confirmDelete) return;

  try {
    if (supabaseClient) {
      const { error } = await supabaseClient
        .from('productos_catalogo')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showToast('Producto eliminado de la nube');
    } else {
      showToast('Producto eliminado');
    }

    await dbDelete(id);
    notifyUpdate();

    if (editProductId.value === id) {
      cancelEdit();
    }

    await refreshAdminList();
  } catch (error) {
    console.error('Error al eliminar:', error);
    showToast('Error al eliminar');
  }
}

// Compresión de fotos
function setActiveTab(tabName) {
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  if (tabName === 'upload') {
    tabUploadContent.classList.remove('hidden');
    tabUrlContent.classList.add('hidden');
  } else {
    tabUploadContent.classList.add('hidden');
    tabUrlContent.classList.remove('hidden');
  }
}

function processAndCompressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;

      img.onload = () => {
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(compressedDataUrl);
      };

      img.onerror = (err) => reject(err);
    };

    reader.onerror = (err) => reject(err);
  });
}

async function handleFileSelected(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Selecciona un archivo de imagen válido');
    return;
  }

  try {
    showToast('Procesando foto...');
    const compressed = await processAndCompressImage(file);
    currentImageBase64 = compressed;
    imagePreview.src = compressed;
    imagePreviewContainer.classList.remove('hidden');
    showToast('Foto lista');
  } catch (e) {
    console.error(e);
    showToast('No se pudo procesar la imagen');
  }
}

// Ajustes y Backups
function openSettingsModal() {
  storeNameInput.value = settings.storeName || '';
  storeSubtitleInput.value = settings.storeSubtitle || '';
  currencyInput.value = settings.currency || '$';
  whatsappPhoneInput.value = settings.whatsappPhone || '';
  newPasswordInput.value = '';
  confirmPasswordInput.value = '';
  settingsDialog.showModal();
}

function handleSettingsSubmit(e) {
  e.preventDefault();

  settings.storeName = storeNameInput.value.trim() || 'Mi Catálogo';
  settings.storeSubtitle = storeSubtitleInput.value.trim() || 'Catálogo de productos';
  settings.currency = currencyInput.value.trim() || '$';
  settings.whatsappPhone = cleanWhatsappPhone(whatsappPhoneInput.value.trim());
  saveSettings();

  const newPass = newPasswordInput.value.trim();
  const confirmPass = confirmPasswordInput.value.trim();

  if (newPass) {
    if (newPass.length < 4) {
      alert('La nueva clave debe tener al menos 4 caracteres.');
      return;
    }
    if (newPass !== confirmPass) {
      alert('Las claves no coinciden.');
      return;
    }

    localStorage.setItem(PASS_STORAGE_KEY, newPass);
    showToast('¡Clave y ajustes actualizados!');
  } else {
    showToast('Ajustes guardados');
  }

  settingsDialog.close();
  renderAdminProductsList();
}

function exportBackup() {
  const data = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    settings: settings,
    products: products
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `catalogo-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Copia descargada');
}

async function importBackup(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!Array.isArray(data.products)) {
      throw new Error('Archivo de copia no válido');
    }

    const confirmImport = window.confirm(
      `Se encontraron ${data.products.length} productos en la copia. ¿Deseas reemplazar los productos actuales?`
    );

    if (!confirmImport) return;

    if (supabaseClient) {
      for (const item of data.products) {
        await supabaseClient.from('productos_catalogo').upsert([{
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          description: item.description,
          image: item.image,
          created_at: item.createdAt || Date.now()
        }]);
      }
    }

    await dbClear();
    for (const item of data.products) {
      await dbPut(item);
    }

    if (data.settings) {
      settings = { ...defaultSettings, ...data.settings };
      saveSettings();
    }

    await refreshAdminList();
    settingsDialog.close();
    showToast(`¡Copia restaurada! ${products.length} productos.`);
  } catch (error) {
    console.error(error);
    alert('Error al leer el archivo JSON.');
  }
}

async function resetDemoData() {
  const confirmReset = window.confirm('¿Deseas restablecer los productos de ejemplo iniciales?');
  if (!confirmReset) return;

  try {
    const sampleProducts = [
      {
        id: 'prod-1',
        name: 'Auriculares Inalámbricos Pro',
        price: 4999.00,
        category: 'Tecnología',
        description: 'Auriculares con cancelación de ruido activa, conexión Bluetooth 5.3 y estuche de carga.',
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=700&q=80',
        createdAt: Date.now() - 300000
      },
      {
        id: 'prod-2',
        name: 'Mochila Urbana Impermeable',
        price: 3200.00,
        category: 'Accesorios',
        description: 'Compartimento para notebook de hasta 15.6 pulgadas, impermeable.',
        image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=700&q=80',
        createdAt: Date.now() - 200000
      }
    ];

    if (supabaseClient) {
      for (const item of sampleProducts) {
        await supabaseClient.from('productos_catalogo').upsert([{
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          description: item.description,
          image: item.image,
          created_at: item.createdAt
        }]);
      }
    }

    await dbClear();
    for (const item of sampleProducts) {
      await dbPut(item);
    }

    await refreshAdminList();
    settingsDialog.close();
    showToast('Productos de muestra restaurados');
  } catch (error) {
    console.error(error);
    showToast('Error al restablecer');
  }
}

function setupEventListeners() {
  loginForm.addEventListener('submit', handleLogin);
  btnTogglePassword.addEventListener('click', () => {
    const isPass = passwordInput.type === 'password';
    passwordInput.type = isPass ? 'text' : 'password';
    btnTogglePassword.textContent = isPass ? '🙈' : '👁️';
  });

  btnLogout.addEventListener('click', handleLogout);
  productManageForm.addEventListener('submit', handleProductSubmit);
  btnCancelEdit.addEventListener('click', cancelEdit);

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  imageFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  imageUrlInput.addEventListener('input', () => {
    const val = imageUrlInput.value.trim();
    if (val) {
      currentImageBase64 = val;
      imagePreview.src = val;
      imagePreviewContainer.classList.remove('hidden');
    }
  });

  btnRemoveImage.addEventListener('click', () => {
    currentImageBase64 = '';
    imageFileInput.value = '';
    imageUrlInput.value = '';
    imagePreview.src = '';
    imagePreviewContainer.classList.add('hidden');
  });

  btnOpenSettings.addEventListener('click', openSettingsModal);
  btnCloseSettingsModal.addEventListener('click', () => settingsDialog.close());
  btnCancelSettings.addEventListener('click', () => settingsDialog.close());
  settingsForm.addEventListener('submit', handleSettingsSubmit);

  settingsDialog.addEventListener('click', (e) => {
    const rect = settingsDialog.getBoundingClientRect();
    const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
    if (!isInDialog) {
      settingsDialog.close();
    }
  });

  btnExportBackup.addEventListener('click', exportBackup);
  backupFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      importBackup(e.target.files[0]);
    }
  });
  btnResetDemoData.addEventListener('click', resetDemoData);
  setupThemeToggle();
}

function setupThemeToggle() {
  const btnTheme = document.getElementById('btnThemeToggle');
  if (!btnTheme) return;

  function updateIcon(theme) {
    btnTheme.textContent = theme === 'light' ? '☀️' : '🌙';
  }

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  updateIcon(currentTheme);

  btnTheme.addEventListener('click', () => {
    const active = document.documentElement.getAttribute('data-theme') || 'dark';
    const nextTheme = active === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('catalogo_theme', nextTheme);
    updateIcon(nextTheme);
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let toastTimer = null;
function showToast(msg) {
  toastMessage.textContent = msg;
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2800);
}

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAccess();
});
