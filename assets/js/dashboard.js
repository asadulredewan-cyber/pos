// assets/js/dashboard.js
// Dashboard (Complete) - Allowed-shops aggregation + single-shop behavior
import { initLayout } from "./layout.js";
import { db, auth } from "../../firebase/config.js";

import {
  collection,
  getDocs,
  query,
  where,
  getDoc,
  doc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

/* ----------------- Configuration ----------------- */
// If true and user.role === 'admin' then 'all' will fetch system-wide aggregation.
// Usually keep false to ensure admins only see their assigned shops.
const ALLOW_GLOBAL_ALL_FOR_ADMIN = false;

/* ----------------- Init layout ----------------- */
initLayout && initLayout("Dashboard"); // safe-call in case layout missing

/* ----------------- Globals ----------------- */
let currentShopId = localStorage.getItem("active_shop") || null;
let currentUserProfile = null;
let shopDataBreakdown = {};
let recentSalesList = [];
window.__AGGREGATED_PRODUCTS = [];

/* ----------------- Auth bootstrap ----------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // not signed in
    const el = document.getElementById("todaySalesAmount");
    if (el) el.innerText = "Not signed in";
    return;
  }

  // fetch user profile
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    currentUserProfile = snap.exists() ? snap.data() : { role: "seller", shopid: "", shops: [] };
  } catch (err) {
    console.error("Failed to load user profile:", err);
    currentUserProfile = { role: "seller", shopid: "", shops: [] };
  }

  // validate active shop "all" permission
  if (currentShopId === "all") {
    const allowed = getUserShops();
    const isAdminGlobal = ALLOW_GLOBAL_ALL_FOR_ADMIN && currentUserProfile?.role === 'admin';
    if (!isAdminGlobal && (!allowed || allowed.length === 0)) {
      currentShopId = allowed[0] || null;
      localStorage.setItem("active_shop", currentShopId || "");
    }
  }

  // show main UI
  const main = document.getElementById("main-content-body");
  if (main) main.style.display = "block";

  // load data
  loadDashboardData();
});

/* ----------------- Helpers ----------------- */
// return normalized array of user's shops
function getUserShops() {
  if (!currentUserProfile) return [];
  const arr = Array.isArray(currentUserProfile.shops) ? currentUserProfile.shops.slice() : [];
  if (currentUserProfile.shopId && !arr.includes(currentUserProfile.shopId)) arr.push(currentUserProfile.shopId);
  if (currentUserProfile.shopid && !arr.includes(currentUserProfile.shopid)) arr.push(currentUserProfile.shopid);
  return [...new Set(arr.filter(Boolean))];
}

// get shop id from doc (shopId or shopid)
function docShopId(d) {
  return d?.shopId ?? d?.shopid ?? null;
}

function initShopObj(id) {
  if (!id) return;
  if (!shopDataBreakdown[id]) shopDataBreakdown[id] = { products: 0, customers: 0, sales: 0, buyCost: 0 };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ----------------- Load Dashboard ----------------- */
async function loadDashboardData() {
  if (!currentShopId) {
    document.getElementById("todaySalesAmount").innerText = "No shop selected";
    document.getElementById("totalProductsCount").innerText = "-";
    document.getElementById("totalCustomersCount").innerText = "-";
    return;
  }

  document.getElementById("todaySalesAmount").innerText = "Loading...";
  shopDataBreakdown = {};
  recentSalesList = [];
  window.__AGGREGATED_PRODUCTS = [];

  if (currentShopId !== "all") {
    await fetchSingleShopData(currentShopId);
  } else {
    await fetchAllAllowedShopsData();
  }
}

/* ----------------- SINGLE SHOP ----------------- */
async function fetchSingleShopData(shopId) {
  // products
  const prodDocs = await queryByShopField("products", shopId);
  document.getElementById("totalProductsCount").innerText = prodDocs.length + " টি";

  // customers
  const custDocs = await queryByShopField("customers", shopId);
  document.getElementById("totalCustomersCount").innerText = custDocs.length + " জন";

  // invoices (today)
  const dateStr = formatDate(new Date());
  const invDocs = await queryInvoicesByShopAndDate(shopId, dateStr);

  let totalSale = 0;
  recentSalesList = [];

  invDocs.forEach(d => {
    totalSale += Number(d.grandTotal || 0);
    recentSalesList.push({ id: d.id || d._id || "", ...d });
  });

  document.getElementById("todaySalesAmount").innerText = "৳ " + totalSale.toLocaleString();
  renderRecentSalesTable(recentSalesList, false);
}

/* ----------------- ALLOWED SHOPS AGGREGATION ----------------- */
async function fetchAllAllowedShopsData() {
  const allowedShops = getUserShops();
  const isAdminGlobal = ALLOW_GLOBAL_ALL_FOR_ADMIN && currentUserProfile?.role === 'admin' && currentShopId === 'all';

  if (!isAdminGlobal && (!allowedShops || allowedShops.length === 0)) {
    document.getElementById("todaySalesAmount").innerText = "No assigned shops";
    document.getElementById("salesBuyInfo").innerText = "";
    document.getElementById("totalProductsCount").innerText = "-";
    document.getElementById("totalCustomersCount").innerText = "-";
    return;
  }

  shopDataBreakdown = {};
  recentSalesList = [];
  const productMap = new Map();

  // products: fetch all and filter (safe)
  const pSnap = await getDocs(collection(db, "products"));
  let totalProd = 0;
  pSnap.forEach(docSnap => {
    const d = docSnap.data();
    const sId = docShopId(d);
    if (!isAdminGlobal && !allowedShops.includes(sId)) return;
    if (!sId) return;

    if (!shopDataBreakdown[sId]) initShopObj(sId);
    shopDataBreakdown[sId].products += 1;
    totalProd++;

    const prodKey = docSnap.id; // use doc id
    const entry = productMap.get(prodKey) || { id: docSnap.id, name: d.name || "(no-name)", totalQty: 0, perShop: {} };
    const qty = Number(d.qty ?? d.quantity ?? d.stock ?? 0);
    entry.totalQty += qty;
    entry.perShop[sId] = (entry.perShop[sId] || 0) + qty;
    productMap.set(prodKey, entry);
  });
  document.getElementById("totalProductsCount").innerText = totalProd + " টি";

  // customers
  const cSnap = await getDocs(collection(db, "customers"));
  let totalCus = 0;
  cSnap.forEach(docSnap => {
    const d = docSnap.data();
    const sId = docShopId(d);
    if (!isAdminGlobal && !allowedShops.includes(sId)) return;
    if (!sId) return;
    if (!shopDataBreakdown[sId]) initShopObj(sId);
    shopDataBreakdown[sId].customers += 1;
    totalCus++;
  });
  document.getElementById("totalCustomersCount").innerText = totalCus + " জন";

  // invoices today
  const dateStr = formatDate(new Date());
  const invSnap = await getDocs(collection(db, "invoices"));
  let totalSale = 0;
  let totalBuyCost = 0;
  invSnap.forEach(docSnap => {
    const d = docSnap.data();
    const sId = docShopId(d);
    if (!isAdminGlobal && !allowedShops.includes(sId)) return;
    if (!sId) return;
    if (String(d.date) === dateStr) {
      if (!shopDataBreakdown[sId]) initShopObj(sId);
      const sale = Number(d.grandTotal || 0);
      const profit = Number(d.totalProfit || 0);
      const cost = (Number(d.subTotal || sale) - profit);
      shopDataBreakdown[sId].sales += sale;
      shopDataBreakdown[sId].buyCost += cost;
      totalSale += sale;
      totalBuyCost += cost;
      recentSalesList.push({ id: docSnap.id, ...d });
    }
  });

  document.getElementById("todaySalesAmount").innerText = "৳ " + totalSale.toLocaleString();
  document.getElementById("salesBuyInfo").innerText = `(মোট কেনা খরচ: ৳ ${totalBuyCost.toLocaleString()})`;

  // Save aggregated products globally for modal uses
  window.__AGGREGATED_PRODUCTS = Array.from(productMap.values());

  // Render recent and keep showShopName = true
  renderRecentSalesTable(recentSalesList, true);
}

/* ----------------- Query helpers ----------------- */
async function queryByShopField(collectionName, shopId) {
  const resultsMap = new Map();
  try {
    const q1 = query(collection(db, collectionName), where("shopId", "==", shopId));
    const s1 = await getDocs(q1);
    s1.forEach(ds => resultsMap.set(ds.id, { id: ds.id, ...ds.data() }));

    const q2 = query(collection(db, collectionName), where("shopid", "==", shopId));
    const s2 = await getDocs(q2);
    s2.forEach(ds => resultsMap.set(ds.id, { id: ds.id, ...ds.data() }));
  } catch (err) {
    console.warn("queryByShopField fallback:", err);
    const all = await getDocs(collection(db, collectionName));
    all.forEach(ds => {
      const d = ds.data();
      const sId = docShopId(d);
      if (sId === shopId) resultsMap.set(ds.id, { id: ds.id, ...d });
    });
  }
  return Array.from(resultsMap.values());
}

async function queryInvoicesByShopAndDate(shopId, dateStr) {
  const resultsMap = new Map();
  try {
    const q1 = query(collection(db, "invoices"), where("shopId", "==", shopId), where("date", "==", dateStr));
    const s1 = await getDocs(q1);
    s1.forEach(ds => resultsMap.set(ds.id, { id: ds.id, ...ds.data() }));

    const q2 = query(collection(db, "invoices"), where("shopid", "==", shopId), where("date", "==", dateStr));
    const s2 = await getDocs(q2);
    s2.forEach(ds => resultsMap.set(ds.id, { id: ds.id, ...ds.data() }));
  } catch (err) {
    console.warn("queryInvoicesByShopAndDate fallback:", err);
    const all = await getDocs(collection(db, "invoices"));
    all.forEach(ds => {
      const d = ds.data();
      const sId = docShopId(d);
      if (sId === shopId && String(d.date) === dateStr) resultsMap.set(ds.id, { id: ds.id, ...d });
    });
  }
  return Array.from(resultsMap.values());
}

/* ----------------- Render recent sales ----------------- */
function renderRecentSalesTable(data, showShopName) {
  const thead = document.getElementById("recentTableHead");
  const tbody = document.getElementById("recentTableBody");
  const notice = document.getElementById("recentInfoText");
  tbody.innerHTML = "";

  data.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
  const last6 = data.slice(0, 6);
  notice.innerText = `সর্বশেষ ${last6.length}টি ইনভয়েস দেখানো হচ্ছে`;

  let shopHeader = showShopName ? `<th>দোকান</th>` : "";
  thead.innerHTML = `<tr>
    <th>অর্ডার আইডি</th>
    ${shopHeader}
    <th>সময়</th>
    <th>কাস্টমার</th>
    <th>মোট</th>
    <th>একশন</th>
  </tr>`;

  if (last6.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${showShopName ? 6 : 5}" style="text-align:center;padding:20px;">আজকের কোনো সেলস নেই</td></tr>`;
    return;
  }

  last6.forEach(inv => {
    let time = "-";
    if (inv.timestamp) {
      const d = new Date(inv.timestamp.toDate ? inv.timestamp.toDate() : inv.timestamp);
      time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    const shopCol = showShopName ? `<td><span class="badge" style="background:#e0f2fe;color:#0284ff;">${inv.shopId || inv.shopid || currentShopId}</span></td>` : "";

    tbody.innerHTML += `<tr>
      <td>#${(inv.id || "").toString().slice(0, 6)}</td>
      ${shopCol}
      <td>${time}</td>
      <td>${inv.customerName || "Walk-in"} <br><small style="color:#888;">${inv.customerPhone || ""}</small></td>
      <td style="font-weight:bold;">৳ ${inv.grandTotal || 0}</td>
      <td><button class="btn-view-receipt" onclick="viewReceipt('${inv.id || ""}')">View</button></td>
    </tr>`;
  });
}

/* ----------------- Product breakdown modal (click on aggregated product) ----------------- */
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escapeJs(s) {
  if (!s) return "";
  return String(s).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

window.showProductBreakdown = (prodId) => {
  const list = window.__AGGREGATED_PRODUCTS || [];
  const item = list.find(p => p.id === prodId);
  if (!item) {
    alert("No product data found.");
    return;
  }

  // create modal element if not exist
  let modal = document.getElementById("productBreakdownModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "productBreakdownModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:700px;">
        <span class="close-modal" onclick="document.getElementById('productBreakdownModal').style.display='none'">&times;</span>
        <h3 style="margin-bottom:8px;">পণ্যের দোকানভিত্তিক স্টক</h3>
        <div id="productBreakdownBody"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const body = document.getElementById("productBreakdownBody");
  body.innerHTML = `<h4 style="margin:0 0 6px 0;">${escapeHtml(item.name || "(no-name)")}</h4>
    <p>মোট স্টক: <strong>${item.totalQty}</strong></p>
    <table style="width:100%; border-collapse: collapse; margin-top:8px;">
      <thead><tr style="background:#0d1b2a;color:#fff;"><th style="padding:8px;text-align:left">দোকান</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:center">Action</th></tr></thead>
      <tbody>
      ${Object.keys(item.perShop).map(shop => `
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:8px;">${escapeHtml(shop)}</td>
          <td style="padding:8px;text-align:right">${item.perShop[shop]}</td>
          <td style="padding:8px;text-align:center;">
            <button style="padding:6px 10px;border-radius:6px;background:#0d1b2a;color:#fff;border:0;cursor:pointer;"
              onclick="handleGoToShop('${escapeJs(shop)}','${escapeJs(item.id)}')">Go</button>
          </td>
        </tr>
      `).join("")}
      </tbody>
    </table>`;

  modal.style.display = "flex";
};

window.handleGoToShop = (shopName, prodId) => {
  const allowed = getUserShops();
  // admins: if ALLOW_GLOBAL... false, we still only allow if in allowed list
  if (!allowed.includes(shopName)) {
    alert("You are not allowed to open this shop.");
    return;
  }

  localStorage.setItem("active_shop", shopName);
  // close modal
  const modal = document.getElementById("productBreakdownModal");
  if (modal) modal.style.display = "none";

  // redirect to products page with focus param
  const target = `products.html?focus=${encodeURIComponent(prodId)}`;
  window.location.href = target;
};

/* ----------------- NAV ACTIONS ----------------- */
window.switchToShop = (shopName, redirectUrl = "dashboard.html") => {
  const allowed = getUserShops();
  if (!allowed.includes(shopName)) {
    alert("You are not allowed to switch to this shop.");
    return;
  }
  localStorage.setItem("active_shop", shopName);
  window.location.href = redirectUrl;
};

window.handleCardClick = (type) => {
  // if single-shop selected -> go to respective page
  if (currentShopId && currentShopId !== "all") {
    if (type === "sales") window.location.href = "pos.html"; // or your sales page
    if (type === "products") window.location.href = "products.html";
    if (type === "customers") window.location.href = "customers.html";
    return;
  }

  // if 'all' mode -> show modal list (per-shop)
  openListModal(type);
};

/* ----------------- List modal (for All mode) ----------------- */
function openListModal(type) {
  const allowed = getUserShops();
  if (!allowed || allowed.length === 0) {
    alert("No assigned shops to show.");
    return;
  }

  // create modal if not exist
  let modal = document.getElementById("listModal");
  if (!modal) {
    // assume your HTML has #listModal; if not, create dynamically
    modal = document.createElement("div");
    modal.id = "listModal";
    modal.className = "modal";
    modal.innerHTML = `<div class="modal-content" style="max-width:700px;">
      <span class="close-modal" onclick="document.getElementById('listModal').style.display='none'">&times;</span>
      <h3 id="listModalTitle" style="margin-bottom:10px;">বিস্তারিত</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%; text-align:left; border-collapse: collapse;">
          <thead id="listModalHead" style="background:#f1f1f1;"></thead>
          <tbody id="listModalBody"></tbody>
        </table>
      </div>
    </div>`;
    document.body.appendChild(modal);
  }

  const head = document.getElementById("listModalHead");
  const body = document.getElementById("listModalBody");
  head.innerHTML = "";
  body.innerHTML = "";

  if (type === "products") {
    head.innerHTML = `<tr><th>দোকান</th><th>মোট পণ্য</th><th>Action</th></tr>`;
    allowed.forEach(s => {
      const count = shopDataBreakdown[s]?.products || 0;
      body.innerHTML += `<tr><td style="padding:10px;">${escapeHtml(s)}</td><td style="padding:10px;">${count} টি</td>
        <td style="padding:10px;"><button onclick="switchToShop('${escapeJs(s)}','products.html')">Go</button></td></tr>`;
    });
  } else if (type === "customers") {
    head.innerHTML = `<tr><th>দোকান</th><th>কাস্টমার</th><th>Action</th></tr>`;
    allowed.forEach(s => {
      const count = shopDataBreakdown[s]?.customers || 0;
      body.innerHTML += `<tr><td style="padding:10px;">${escapeHtml(s)}</td><td style="padding:10px;">${count} জন</td>
        <td style="padding:10px;"><button onclick="switchToShop('${escapeJs(s)}','customers.html')">Go</button></td></tr>`;
    });
  } else if (type === "sales") {
    head.innerHTML = `<tr><th>দোকান</th><th>আজকের সেলস</th><th>Action</th></tr>`;
    allowed.forEach(s => {
      const sale = shopDataBreakdown[s]?.sales || 0;
      body.innerHTML += `<tr><td style="padding:10px;">${escapeHtml(s)}</td><td style="padding:10px;">৳ ${sale}</td>
        <td style="padding:10px;"><button onclick="switchToShop('${escapeJs(s)}','pos.html')">Go</button></td></tr>`;
    });
  }

  modal.style.display = "flex";
}

/* ----------------- Utility: open receipt (placeholder) ----------------- */
window.viewReceipt = async (invId) => {
  // You probably have a function to render invoice - keep that
  // for now open receipt modal and show id
  const receiptModal = document.getElementById("receiptModal");
  const receiptContent = document.getElementById("receiptContent");
  if (receiptContent) receiptContent.innerHTML = `<h3>Invoice: ${escapeHtml(invId)}</h3><p>ডেটা লোড করুন...</p>`;
  if (receiptModal) receiptModal.style.display = "flex";
};

/* ----------------- Initial UI: show active shop on sidebar (if layout exposes element) ----------------- */
function reflectActiveShopUI() {
  try {
    const elems = document.querySelectorAll(".shop-name-display, .sidebar-select");
    elems.forEach(el => {
      if (el.tagName === "SELECT") {
        // select value
        const opt = Array.from(el.options).find(o => o.value === currentShopId);
        if (opt) el.value = currentShopId;
      } else {
        if (el.innerText !== undefined) el.innerText = currentShopId || "All Shops";
      }
    });
  } catch (e) { /* ignore */ }
}
reflectActiveShopUI();

/* ----------------- Export nothing; this file runs on load ----------------- */
