/**
 * Catálogo Público de Productos (index.html)
 * - Vista 100% limpia para clientes
 * - Sincronización en la nube con Supabase (en tiempo real)
 * - Modo fallback local en IndexedDB si no se configuró Supabase
 */

// 1. Inicialización de Supabase con limpieza automática de URL
const rawUrl = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL.trim() : '';
const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const isSupabaseActive = typeof supabase !== 'undefined' &&
  cleanUrl.startsWith('https://') &&
  !cleanUrl.includes('TU-PROYECTO');

const supabaseClient = isSupabaseActive ? supabase.createClient(cleanUrl, SUPABASE_ANON_KEY.trim()) : null;

// 2. Base de Datos Local (Fallback)
const DB_NAME = 'CatalogoSimpleDB';
const DB_VERSION = 1;
const STORE_NAME = 'productos';

let db = null;
let products = [];
let activeCategory = 'all';
let currentSearch = '';

const defaultSettings = {
  storeName: 'Mi Catálogo',
  storeSubtitle: 'Catálogo de productos disponibles',
  currency: '$',
  whatsappPhone: ''
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

// Elementos DOM
const storeTitleDisplay = document.getElementById('storeTitleDisplay');
const storeSubtitleDisplay = document.getElementById('storeSubtitleDisplay');
const footerStoreName = document.getElementById('footerStoreName');
const searchInput = document.getElementById('searchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const categoryPills = document.getElementById('categoryPills');
const productsGrid = document.getElementById('productsGrid');
const emptyState = document.getElementById('emptyState');
const catalogStats = document.getElementById('catalogStats');

const detailDialog = document.getElementById('detailDialog');
const btnCloseDetailModal = document.getElementById('btnCloseDetailModal');
const detailImage = document.getElementById('detailImage');
const detailCategory = document.getElementById('detailCategory');
const detailTitle = document.getElementById('detailTitle');
const detailPrice = document.getElementById('detailPrice');
const detailDescription = document.getElementById('detailDescription');
const detailWhatsappBtn = document.getElementById('detailWhatsappBtn');

async function startCatalog() {
  loadSettings();
  applySettings();

  try {
    await initDB();
  } catch (e) {
    console.warn('IndexedDB no disponible, usando memoria:', e);
  }

  await refreshProducts();

  // Suscribirse a cambios en tiempo real si Supabase está activo
  if (supabaseClient) {
    try {
      supabaseClient
        .channel('cambios-catalogo')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'productos_catalogo' }, () => {
          refreshProducts();
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime Supabase:', e);
    }
  }

  setupEventListeners();
}

async function refreshProducts() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('productos_catalogo')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      products = (data || []).map(item => ({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        category: item.category,
        description: item.description,
        image: item.image,
        createdAt: Number(item.created_at)
      }));
    } catch (err) {
      console.error('Error al cargar de Supabase, usando respaldo local:', err);
      products = await dbGetAll();
    }
  } else {
    products = await dbGetAll();
  }

  renderCatalog();
  updateCategoryFilters();
}

function loadSettings() {
  const saved = localStorage.getItem('catalogo_config');
  if (saved) {
    try {
      settings = { ...defaultSettings, ...JSON.parse(saved) };
    } catch (e) {
      console.error(e);
    }
  }
}

function applySettings() {
  storeTitleDisplay.textContent = settings.storeName || 'Mi Catálogo';
  storeSubtitleDisplay.textContent = settings.storeSubtitle || 'Catálogo de productos disponibles';
  footerStoreName.textContent = settings.storeName || 'Mi Catálogo';
  document.title = `${settings.storeName || 'Mi Catálogo'} - Catálogo Online`;
}

function formatPrice(amount) {
  const symbol = settings.currency || '$';
  const num = parseFloat(amount);
  if (isNaN(num)) return `${symbol} 0.00`;
  return `${symbol} ${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderCatalog() {
  const filtered = products.filter(p => {
    const matchCategory = (activeCategory === 'all') || (p.category && p.category.toLowerCase() === activeCategory.toLowerCase());
    const query = currentSearch.toLowerCase().trim();
    const matchSearch = !query || 
      (p.name && p.name.toLowerCase().includes(query)) ||
      (p.description && p.description.toLowerCase().includes(query)) ||
      (p.category && p.category.toLowerCase().includes(query));

    return matchCategory && matchSearch;
  });

  filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  productsGrid.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    productsGrid.classList.add('hidden');

    if (products.length === 0) {
      catalogStats.textContent = 'Catálogo vacío';
      document.getElementById('emptyTitle').textContent = 'Próximamente nuevos productos';
      document.getElementById('emptySubtitle').textContent = 'Estamos actualizando el catálogo. Vuelve a visitarnos pronto.';
    } else {
      catalogStats.textContent = '0 productos encontrados';
      document.getElementById('emptyTitle').textContent = 'Sin resultados';
      document.getElementById('emptySubtitle').textContent = 'No encontramos productos que coincidan con tu búsqueda.';
    }
  } else {
    emptyState.classList.add('hidden');
    productsGrid.classList.remove('hidden');
    catalogStats.textContent = `Mostrando ${filtered.length} ${filtered.length === 1 ? 'producto' : 'productos'}`;

    filtered.forEach(product => {
      const card = createProductCard(product);
      productsGrid.appendChild(card);
    });
  }
}

function createProductCard(p) {
  const card = document.createElement('article');
  card.className = 'product-card';
  card.dataset.id = p.id;

  const placeholderImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="%23e2e8f0"><rect width="400" height="300"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" fill="%2394a3b8">Sin imagen</text></svg>';
  const imgSrc = p.image || placeholderImg;
  const categoryName = p.category ? escapeHTML(p.category) : 'General';
  const waUrl = getWhatsappLink(p);

  card.innerHTML = `
    <div class="product-image-container" onclick="openDetailModal('${p.id}')">
      <img src="${imgSrc}" alt="${escapeHTML(p.name)}" loading="lazy" onerror="this.src='${placeholderImg}'">
      <span class="product-card-badge">${categoryName}</span>
    </div>
    <div class="product-content">
      <h3 class="product-title" onclick="openDetailModal('${p.id}')">${escapeHTML(p.name)}</h3>
      <div class="product-price">${formatPrice(p.price)}</div>
      <p class="product-desc">${p.description ? escapeHTML(p.description) : 'Sin descripción'}</p>
      <div class="product-footer">
        <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm full-width" onclick="event.stopPropagation()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          Pedir por WhatsApp
        </a>
      </div>
    </div>
  `;

  return card;
}

function getWhatsappLink(product) {
  const phone = settings.whatsappPhone ? settings.whatsappPhone.replace(/[^0-9]/g, '') : '';
  const text = encodeURIComponent(`Hola! Me interesa este producto de su catálogo:\n- *${product.name}*\n- Precio: ${formatPrice(product.price)}`);
  
  if (phone) {
    return `https://wa.me/${phone}?text=${text}`;
  }
  return `https://api.whatsapp.com/send?text=${text}`;
}

function updateCategoryFilters() {
  const categories = new Set();
  products.forEach(p => {
    if (p.category && p.category.trim()) {
      categories.add(p.category.trim());
    }
  });

  const sortedCategories = Array.from(categories).sort((a, b) => a.localeCompare(b));
  categoryPills.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = `pill ${activeCategory === 'all' ? 'active' : ''}`;
  allBtn.textContent = 'Todos';
  allBtn.onclick = () => {
    activeCategory = 'all';
    updateCategoryPillsSelection();
    renderCatalog();
  };
  categoryPills.appendChild(allBtn);

  sortedCategories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `pill ${activeCategory.toLowerCase() === cat.toLowerCase() ? 'active' : ''}`;
    btn.textContent = cat;
    btn.onclick = () => {
      activeCategory = cat;
      updateCategoryPillsSelection();
      renderCatalog();
    };
    categoryPills.appendChild(btn);
  });
}

function updateCategoryPillsSelection() {
  const pills = categoryPills.querySelectorAll('.pill');
  pills.forEach(p => {
    if (p.textContent === 'Todos' && activeCategory === 'all') {
      p.classList.add('active');
    } else if (p.textContent.toLowerCase() === activeCategory.toLowerCase()) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
}

function openDetailModal(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;

  const placeholderImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="%23e2e8f0"><rect width="400" height="300"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" fill="%2394a3b8">Sin imagen</text></svg>';

  detailImage.src = p.image || placeholderImg;
  detailCategory.textContent = p.category || 'General';
  detailTitle.textContent = p.name;
  detailPrice.textContent = formatPrice(p.price);
  detailDescription.textContent = p.description || 'Sin descripción disponible.';
  detailWhatsappBtn.href = getWhatsappLink(p);

  detailDialog.showModal();
}

function setupEventListeners() {
  searchInput.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    btnClearSearch.classList.toggle('hidden', !currentSearch);
    renderCatalog();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    btnClearSearch.classList.add('hidden');
    renderCatalog();
    searchInput.focus();
  });

  btnCloseDetailModal.addEventListener('click', () => detailDialog.close());

  detailDialog.addEventListener('click', (e) => {
    const rect = detailDialog.getBoundingClientRect();
    const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
    if (!isInDialog) {
      detailDialog.close();
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'catalogo_last_updated_time' || e.key === 'catalogo_config') {
      loadSettings();
      applySettings();
      refreshProducts();
    }
  });

  window.addEventListener('focus', () => {
    loadSettings();
    applySettings();
    refreshProducts();
  });

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

document.addEventListener('DOMContentLoaded', startCatalog);
