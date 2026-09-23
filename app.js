/**
 * Catálogo Público de Productos (index.html)
 * - Vista 100% limpia para clientes
 * - Sincronización en tiempo real con Supabase
 * - Carrito de Pedidos Consolidado para WhatsApp
 * - Paginación Progresiva (Infinite Scroll / Cargar Más)
 * - Fallback local en IndexedDB
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

// Paginación Progresiva
const PAGE_SIZE = 24;
let visibleCount = PAGE_SIZE;
let paginationObserver = null;
let currentDetailProductId = null;

// Sanitizador de teléfono de WhatsApp para enlace directo
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

// Carrito de Pedido (Persistido en localStorage)
let cart = loadCart();

function loadCart() {
  try {
    const raw = localStorage.getItem('catalogo_cart');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem('catalogo_cart', JSON.stringify(cart));
  } catch (e) {
    console.warn('Error al guardar carrito:', e);
  }
  updateCartUI();
}

function addToCart(productId, quantity = 1) {
  const p = products.find(x => x.id === productId);
  if (!p) return;

  const existing = cart.find(x => x.id === productId);
  if (existing) {
    existing.quantity = Math.max(1, existing.quantity + quantity);
  } else {
    cart.push({
      id: p.id,
      name: p.name,
      price: Number(p.price) || 0,
      image: p.image || '',
      category: p.category || 'General',
      quantity: Math.max(1, quantity)
    });
  }
  saveCart();
  showToast(`✓ Agregado al pedido (x${quantity})`);
}

function updateCartItemQty(productId, delta) {
  const item = cart.find(x => x.id === productId);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  saveCart();
  renderCartModal();
}

function setCartItemQty(productId, qty) {
  const item = cart.find(x => x.id === productId);
  if (!item) return;
  const val = parseInt(qty);
  if (isNaN(val) || val <= 0) {
    removeFromCart(productId);
  } else {
    item.quantity = val;
    saveCart();
    renderCartModal();
  }
}

function removeFromCart(productId) {
  cart = cart.filter(x => x.id !== productId);
  saveCart();
  renderCartModal();
}

function clearCart() {
  if (cart.length === 0) return;
  if (confirm('¿Deseas vaciar todos los artículos de tu pedido?')) {
    cart = [];
    saveCart();
    renderCartModal();
  }
}

function updateCartUI() {
  const totalCount = cart.reduce((acc, item) => acc + (item.quantity || 0), 0);
  const navBadge = document.getElementById('navCartBadge');
  const floatingBadge = document.getElementById('floatingCartBadge');
  const floatingBtn = document.getElementById('btnFloatingCart');

  if (navBadge) {
    navBadge.textContent = totalCount;
    navBadge.classList.toggle('hidden', totalCount === 0);
  }
  if (floatingBadge) {
    floatingBadge.textContent = totalCount;
  }
  if (floatingBtn) {
    floatingBtn.classList.toggle('hidden', totalCount === 0);
  }
}

function renderCartModal() {
  const cartItemsList = document.getElementById('cartItemsList');
  const cartEmptyState = document.getElementById('cartEmptyState');
  const cartFormSection = document.getElementById('cartFormSection');
  const cartTotalItemsCount = document.getElementById('cartTotalItemsCount');
  const cartEstimatedTotal = document.getElementById('cartEstimatedTotal');
  const cartUnpricedNotice = document.getElementById('cartUnpricedNotice');
  const btnSendCartWhatsapp = document.getElementById('btnSendCartWhatsapp');

  if (!cartItemsList) return;

  const totalCount = cart.reduce((acc, item) => acc + (item.quantity || 0), 0);
  let subtotal = 0;
  let hasUnpriced = false;

  cartItemsList.innerHTML = '';

  if (cart.length === 0) {
    cartEmptyState.classList.remove('hidden');
    cartItemsList.classList.add('hidden');
    if (cartFormSection) cartFormSection.classList.add('hidden');
    if (btnSendCartWhatsapp) btnSendCartWhatsapp.disabled = true;
  } else {
    cartEmptyState.classList.add('hidden');
    cartItemsList.classList.remove('hidden');
    if (cartFormSection) cartFormSection.classList.remove('hidden');
    if (btnSendCartWhatsapp) btnSendCartWhatsapp.disabled = false;

    const placeholderImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60" fill="%23cbd5e1"><rect width="60" height="60"/></svg>';

    cart.forEach(item => {
      const priceVal = parseFloat(item.price);
      let priceDisplay = 'A consultar';
      if (!isNaN(priceVal) && priceVal > 0) {
        subtotal += priceVal * item.quantity;
        priceDisplay = `${formatPrice(priceVal)} c/u`;
      } else {
        hasUnpriced = true;
      }

      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img src="${item.image || placeholderImg}" class="cart-item-thumb" alt="${escapeHTML(item.name)}" onerror="this.src='${placeholderImg}'">
        <div class="cart-item-info">
          <div class="cart-item-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
          <div class="cart-item-price">${priceDisplay}</div>
        </div>
        <div class="quantity-stepper">
          <button type="button" class="btn-qty" onclick="updateCartItemQty('${item.id}', -1)" aria-label="Restar">−</button>
          <input type="number" value="${item.quantity}" min="1" max="999" onchange="setCartItemQty('${item.id}', this.value)">
          <button type="button" class="btn-qty" onclick="updateCartItemQty('${item.id}', 1)" aria-label="Sumar">+</button>
        </div>
        <button type="button" class="btn-cart-remove" onclick="removeFromCart('${item.id}')" title="Eliminar del pedido" aria-label="Eliminar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;
      cartItemsList.appendChild(row);
    });
  }

  if (cartTotalItemsCount) cartTotalItemsCount.textContent = `${totalCount} ${totalCount === 1 ? 'artículo' : 'artículos'}`;
  if (cartEstimatedTotal) cartEstimatedTotal.textContent = formatPrice(subtotal);
  if (cartUnpricedNotice) cartUnpricedNotice.classList.toggle('hidden', !hasUnpriced);
}

function sendCartToWhatsApp() {
  if (cart.length === 0) return;

  const globalPhone = (typeof STORE_WHATSAPP_PHONE !== 'undefined' && STORE_WHATSAPP_PHONE) ? STORE_WHATSAPP_PHONE : '';
  const rawPhone = settings.whatsappPhone || globalPhone;
  const phone = cleanWhatsappPhone(rawPhone);

  if (!phone) {
    alert('⚠️ Aún no se ha configurado el número de WhatsApp receptor de pedidos.');
    return;
  }

  const customerNameInput = document.getElementById('cartCustomerName');
  const customerNotesInput = document.getElementById('cartCustomerNotes');
  const customerName = customerNameInput ? customerNameInput.value.trim() : '';
  const customerNotes = customerNotesInput ? customerNotesInput.value.trim() : '';

  let message = `🛒 *HOLA! QUIERO REALIZAR EL SIGUIENTE PEDIDO:*\n`;
  if (customerName) {
    message += `👤 *Cliente:* ${customerName}\n`;
  }
  message += `\n📦 *DETALLE DE ARTÍCULOS:*\n`;

  let subtotal = 0;
  let hasUnpriced = false;
  let totalCount = 0;

  cart.forEach((item, index) => {
    totalCount += item.quantity;
    const priceVal = parseFloat(item.price);
    if (!isNaN(priceVal) && priceVal > 0) {
      const lineTotal = priceVal * item.quantity;
      subtotal += lineTotal;
      message += `${index + 1}. *${item.name}*\n   ↳ Cant: *${item.quantity}* (${formatPrice(priceVal)} c/u) = *${formatPrice(lineTotal)}*\n`;
    } else {
      hasUnpriced = true;
      message += `${index + 1}. *${item.name}*\n   ↳ Cant: *${item.quantity}* (Precio a consultar)\n`;
    }
  });

  message += `\n--------------------------------------------\n`;
  message += `📊 *Total de artículos:* ${totalCount}\n`;
  if (subtotal > 0) {
    message += `💰 *Subtotal estimado:* ${formatPrice(subtotal)}${hasUnpriced ? ' (+ artículos a cotizar)' : ''}\n`;
  } else {
    message += `💰 *Subtotal:* A cotizar según disponibilidad y curva de talles\n`;
  }

  if (customerNotes) {
    message += `📝 *Aclaraciones / Talles / Envío:* ${customerNotes}\n`;
  }
  message += `\n¿Me confirmarían disponibilidad y forma de pago? Gracias!`;

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

// 3. Inicialización de Base de Datos IndexedDB
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

const cartDialog = document.getElementById('cartDialog');
const btnOpenCart = document.getElementById('btnOpenCart');
const btnFloatingCart = document.getElementById('btnFloatingCart');
const btnCloseCartModal = document.getElementById('btnCloseCartModal');
const btnClearCart = document.getElementById('btnClearCart');
const btnSendCartWhatsapp = document.getElementById('btnSendCartWhatsapp');

const btnDetailAddToCart = document.getElementById('btnDetailAddToCart');
const btnDetailQtyMinus = document.getElementById('btnDetailQtyMinus');
const btnDetailQtyPlus = document.getElementById('btnDetailQtyPlus');
const detailQtyInput = document.getElementById('detailQtyInput');

const btnLoadMore = document.getElementById('btnLoadMore');

async function startCatalog() {
  loadSettings();
  applySettings();
  updateCartUI();

  try {
    await initDB();
  } catch (e) {
    console.warn('IndexedDB no disponible, usando memoria:', e);
  }

  await refreshProducts();

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

  renderCatalog(true);
  updateCategoryFilters();
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

function applySettings() {
  storeTitleDisplay.textContent = settings.storeName || 'Mi Catálogo';
  storeSubtitleDisplay.textContent = settings.storeSubtitle || 'Catálogo de productos disponibles';
  footerStoreName.textContent = settings.storeName || 'Mi Catálogo';
  document.title = `${settings.storeName || 'Mi Catálogo'} - Catálogo Online`;
}

function formatPrice(amount) {
  const symbol = settings.currency || '$';
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return 'Consultar precio';
  return `${symbol} ${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function loadMoreProducts() {
  visibleCount += PAGE_SIZE;
  renderCatalog(false);
}

function renderCatalog(resetPagination = true) {
  if (resetPagination) {
    visibleCount = PAGE_SIZE;
  }

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

  const paginationWrapper = document.getElementById('paginationWrapper');
  const paginationText = document.getElementById('paginationText');
  const paginationProgress = document.getElementById('paginationProgress');

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    productsGrid.classList.add('hidden');
    if (paginationWrapper) paginationWrapper.classList.add('hidden');

    if (products.length === 0) {
      catalogStats.textContent = 'Catálogo vacío';
      document.getElementById('emptyTitle').textContent = 'Próximamente nuevos productos';
      document.getElementById('emptySubtitle').textContent = 'Estamos actualizando el catálogo. Vuelve a visitarnos pronto.';
    } else {
      catalogStats.textContent = '0 productos encontrados';
      document.getElementById('emptyTitle').textContent = 'Sin resultados';
      document.getElementById('emptySubtitle').textContent = 'No encontramos productos que coincidan con tu búsqueda.';
    }
    return;
  }

  emptyState.classList.add('hidden');
  productsGrid.classList.remove('hidden');

  const itemsToRender = filtered.slice(0, visibleCount);
  catalogStats.textContent = `Mostrando ${itemsToRender.length} de ${filtered.length} ${filtered.length === 1 ? 'producto' : 'productos'}`;

  itemsToRender.forEach(product => {
    const card = createProductCard(product);
    productsGrid.appendChild(card);
  });

  // Paginación Progresiva
  if (paginationWrapper) {
    if (filtered.length > PAGE_SIZE) {
      paginationWrapper.classList.remove('hidden');
      const progressPercent = Math.min(100, Math.round((itemsToRender.length / filtered.length) * 100));
      if (paginationText) {
        paginationText.textContent = `Mostrando ${itemsToRender.length} de ${filtered.length} productos (${progressPercent}%)`;
      }
      if (paginationProgress) {
        paginationProgress.style.width = `${progressPercent}%`;
      }

      if (itemsToRender.length < filtered.length) {
        if (btnLoadMore) {
          const remaining = filtered.length - itemsToRender.length;
          const nextCount = Math.min(PAGE_SIZE, remaining);
          btnLoadMore.style.display = 'inline-flex';
          btnLoadMore.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 13l5 5 5-5M7 6l5 5 5-5"/></svg>
            <span>Cargar ${nextCount} productos más</span>
          `;
        }
        setupIntersectionObserver();
      } else {
        if (btnLoadMore) {
          btnLoadMore.style.display = 'none';
        }
        if (paginationText) {
          paginationText.textContent = `✓ Mostrando los ${filtered.length} productos`;
        }
      }
    } else {
      paginationWrapper.classList.add('hidden');
    }
  }
}

function setupIntersectionObserver() {
  const sentinel = document.getElementById('loadMoreSentinel');
  if (!sentinel) return;

  if (paginationObserver) {
    paginationObserver.disconnect();
  }

  paginationObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        loadMoreProducts();
      }
    });
  }, { rootMargin: '200px' });

  paginationObserver.observe(sentinel);
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
        <div class="product-card-actions">
          <button type="button" class="btn btn-primary btn-add-cart" onclick="event.stopPropagation(); addToCart('${p.id}', 1)" title="Agregar al pedido">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Agregar</span>
          </button>
          <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp-icon" title="Consultar por WhatsApp" onclick="event.stopPropagation()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          </a>
        </div>
      </div>
    </div>
  `;

  return card;
}

function getWhatsappLink(product) {
  const globalPhone = (typeof STORE_WHATSAPP_PHONE !== 'undefined' && STORE_WHATSAPP_PHONE) ? STORE_WHATSAPP_PHONE : '';
  const rawPhone = settings.whatsappPhone || globalPhone;
  const phone = cleanWhatsappPhone(rawPhone);

  const priceVal = parseFloat(product.price);
  const priceInfo = (!isNaN(priceVal) && priceVal > 0) ? `Precio: ${formatPrice(product.price)}` : 'Consultar precio y disponibilidad';
  const text = encodeURIComponent(`Hola! Me interesa este producto de su catálogo:\n- *${product.name}*\n- ${priceInfo}`);
  
  if (phone) {
    return `https://wa.me/${phone}?text=${text}`;
  }
  return `javascript:alert('⚠️ Aún no se ha configurado el número de WhatsApp receptor de pedidos.');`;
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
    renderCatalog(true);
  };
  categoryPills.appendChild(allBtn);

  sortedCategories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `pill ${activeCategory.toLowerCase() === cat.toLowerCase() ? 'active' : ''}`;
    btn.textContent = cat;
    btn.onclick = () => {
      activeCategory = cat;
      updateCategoryPillsSelection();
      renderCatalog(true);
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

  currentDetailProductId = id;
  const placeholderImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="%23e2e8f0"><rect width="400" height="300"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" fill="%2394a3b8">Sin imagen</text></svg>';

  detailImage.src = p.image || placeholderImg;
  detailCategory.textContent = p.category || 'General';
  detailTitle.textContent = p.name;
  detailPrice.textContent = formatPrice(p.price);
  detailDescription.textContent = p.description || 'Sin descripción disponible.';
  detailWhatsappBtn.href = getWhatsappLink(p);

  if (detailQtyInput) {
    detailQtyInput.value = 1;
  }

  detailDialog.showModal();
}

let toastTimeout = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMessage');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  toast.classList.remove('hidden');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2200);
}

function setupEventListeners() {
  searchInput.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    btnClearSearch.classList.toggle('hidden', !currentSearch);
    renderCatalog(true);
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    btnClearSearch.classList.add('hidden');
    renderCatalog(true);
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

  // Modal Carrito
  if (btnOpenCart) {
    btnOpenCart.addEventListener('click', () => {
      renderCartModal();
      cartDialog.showModal();
    });
  }

  if (btnFloatingCart) {
    btnFloatingCart.addEventListener('click', () => {
      renderCartModal();
      cartDialog.showModal();
    });
  }

  if (btnCloseCartModal) {
    btnCloseCartModal.addEventListener('click', () => cartDialog.close());
  }

  if (cartDialog) {
    cartDialog.addEventListener('click', (e) => {
      const rect = cartDialog.getBoundingClientRect();
      const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
      if (!isInDialog) {
        cartDialog.close();
      }
    });
  }

  if (btnClearCart) {
    btnClearCart.addEventListener('click', clearCart);
  }

  if (btnSendCartWhatsapp) {
    btnSendCartWhatsapp.addEventListener('click', sendCartToWhatsApp);
  }

  // Stepper en Modal Detalle
  if (btnDetailQtyMinus && detailQtyInput) {
    btnDetailQtyMinus.addEventListener('click', () => {
      const cur = parseInt(detailQtyInput.value) || 1;
      detailQtyInput.value = Math.max(1, cur - 1);
    });
  }

  if (btnDetailQtyPlus && detailQtyInput) {
    btnDetailQtyPlus.addEventListener('click', () => {
      const cur = parseInt(detailQtyInput.value) || 1;
      detailQtyInput.value = cur + 1;
    });
  }

  if (btnDetailAddToCart) {
    btnDetailAddToCart.addEventListener('click', () => {
      if (currentDetailProductId) {
        const qty = parseInt(detailQtyInput.value) || 1;
        addToCart(currentDetailProductId, qty);
        detailDialog.close();
      }
    });
  }

  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', loadMoreProducts);
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'catalogo_last_updated_time' || e.key === 'catalogo_config') {
      loadSettings();
      applySettings();
      refreshProducts();
    } else if (e.key === 'catalogo_cart') {
      cart = loadCart();
      updateCartUI();
      renderCartModal();
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

// Hacer funciones accesibles desde eventos onclick en HTML
window.addToCart = addToCart;
window.updateCartItemQty = updateCartItemQty;
window.setCartItemQty = setCartItemQty;
window.removeFromCart = removeFromCart;
window.openDetailModal = openDetailModal;

document.addEventListener('DOMContentLoaded', startCatalog);
