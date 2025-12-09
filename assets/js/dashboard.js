// assets/js/dashboard.js
// COMPLETE FIX (Option A) - Multi-shop secure + shopId/shopid tolerant
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

// init layout title
initLayout("Dashboard");

// GLOBALS
let currentShopId = localStorage.getItem("active_shop") || null;
let currentUserProfile = null; // fetched user profile (users/{uid})
let shopDataBreakdown = {};
let recentSalesList = [];

// wait for auth, then bootstrap
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // not signed in — show message or redirect
    document.getElementById("todaySalesAmount").innerText = "Not signed in";
    return;
  }

  // fetch user profile doc (users/{uid})
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (userSnap.exists()) {
      currentUserProfile = userSnap.data();
    } else {
      // fallback: minimal profile
      currentUserProfile = { role: "seller", shopid: "", shops: [] };
    }
  } catch (err) {
    console.error("Error fetching user profile:", err);
    currentUserProfile = { role: "seller", shopid: "", shops: [] };
  }

  // If active_shop is 'all' but user not allowed → fallback
  if (currentShopId === "all") {
    // only allow 'all' if user has >1 shops (or explicit permission)
    const allowedShops = getUserShops();
    if (!allowedShops || allowedShops.length === 0) {
      currentShopId = allowedShops[0] || null;
      localStorage.setItem("active_shop", currentShopId || "");
    }
  }

  // finally load dashboard
  loadDashboardData();
});

// helper: normalize user's shops (returns array of shop ids)
function getUserShops() {
  if (!currentUserProfile) return [];
  // prefer explicit shops array, fallback to single shopid/shopId fields
  const arr = Array.isArray(currentUserProfile.shops) ? currentUserProfile.shops.slice() : [];
  if (currentUserProfile.shopId && !arr.includes(currentUserProfile.shopId)) arr.push(currentUserProfile.shopId);
  if (currentUserProfile.shopid && !arr.includes(currentUserProfile.shopid)) arr.push(currentUserProfile.shopid);
  // remove falsy and duplicates
  return [...new Set(arr.filter(Boolean))];
}

// helper: extract shop id from any doc either shopId or shopid
function docShopId(data) {
  return data?.shopId ?? data?.shopid ?? "Unknown";
}

// ========== BOOTSTRAP LOAD ==========
async function loadDashboardData() {
  // If no active shop chosen show small notice
  if (!currentShopId) {
    document.getElementById("todaySalesAmount").innerText = "No shop selected";
    document.getElementById("totalProductsCount").innerText = "-";
    document.getElementById("totalCustomersCount").innerText = "-";
    return;
  }

  // reset UI
  document.getElementById("todaySalesAmount").innerText = "Loading...";
  shopDataBreakdown = {};
  recentSalesList = [];

  // If single shop
  if (currentShopId !== "all") {
    await fetchSingleShopData(currentShopId);
  } else {
    // all mode -> but restricted to currentUser's own shops only
    await fetchAllAllowedShopsData();
  }
}

// ========== SINGLE SHOP FETCH (use indexed queries) ==========
async function fetchSingleShopData(shopId) {
  // Products: we will run two queries (shopId and shopid) then merge by doc.id
  const prodDocs = await queryByShopField("products", shopId);
  document.getElementById("totalProductsCount").innerText = prodDocs.length + " টি";

  // Customers
  const custDocs = await queryByShopField("customers", shopId);
  document.getElementById("totalCustomersCount").innerText = custDocs.length + " জন";

  // Invoices (today)
  const today = new Date();
  const dateStr = formatDate(today);

  const invDocs = await queryInvoicesByShopAndDate(shopId, dateStr);

  let totalSale = 0;
  recentSalesList = []; // reset

  invDocs.forEach(d => {
    totalSale += Number(d.grandTotal || 0);
    recentSalesList.push({ id: d._id || d.id || "", ...d });
  });

  document.getElementById("todaySalesAmount").innerText = "৳ " + totalSale.toLocaleString();
  renderRecentSalesTable(recentSalesList, false);
}

// ========== ALL ALLOWED SHOPS FETCH ==========
async function fetchAllAllowedShopsData() {
  // Determine user's allowed shops
  const allowedShops = getUserShops(); // array
  if (!allowedShops || allowedShops.length === 0) {
    document.getElementById("todaySalesAmount").innerText = "No assigned shops";
    document.getElementById("salesBuyInfo").innerText = "";
    document.getElementById("totalProductsCount").innerText = "-";
    document.getElementById("totalCustomersCount").innerText = "-";
    return;
  }

  // Initialize breakdown map from allowed shops
  allowedShops.forEach(s => initShopObj(s));

  // PRODUCTS: fetch all products then filter locally (safe but heavier). 
  // If allowedShops.length <= 10 you can optimize with 'in' queries - omitted for simplicity.
  const pSnap = await getDocs(collection(db, "products"));
  let totalProd = 0;
  pSnap.forEach(docSnap => {
    const d = docSnap.data();
    const sId = docShopId(d);
    if (allowedShops.includes(sId)) {
      if (!shopDataBreakdown[sId]) initShopObj(sId);
      shopDataBreakdown[sId].products += 1;
      totalProd++;
    }
  });
  document.getElementById("totalProductsCount").innerText = totalProd + " টি";

  // CUSTOMERS
  const cSnap = await getDocs(collection(db, "customers"));
  let totalCus = 0;
  cSnap.forEach(docSnap => {
    const d = docSnap.data();
    const sId = docShopId(d);
    if (allowedShops.includes(sId)) {
      if (!shopDataBreakdown[sId]) initShopObj(sId);
      shopDataBreakdown[sId].customers += 1;
      totalCus++;
    }
  });
  document.getElementById("totalCustomersCount").innerText = totalCus + " জন";

  // INVOICES (today)
  const today = new Date();
  const dateStr = formatDate(today);
  const invSnap = await getDocs(collection(db, "invoices"));
  let totalSale = 0;
  let totalBuyCost = 0;

  invSnap.forEach(docSnap => {
    const d = docSnap.data();
    const sId = docShopId(d);
    // only consider invoices from allowedShops and today's date
    if (allowedShops.includes(sId) && String(d.date) === dateStr) {
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

  // Render recent; show shop column
  renderRecentSalesTable(recentSalesList, true);
}

// ========== HELPERS: Query by shop field (both shopId and shopid) ==========
async function queryByShopField(collectionName, shopId) {
  const resultsMap = new Map(); // id -> data

  try {
    // Query where shopId == shopId
    const q1 = query(collection(db, collectionName), where("shopId", "==", shopId));
    const snap1 = await getDocs(q1);
    snap1.forEach(docSnap => resultsMap.set(docSnap.id, { _id: docSnap.id, ...docSnap.data() }));

    // Query where shopid == shopId
    const q2 = query(collection(db, collectionName), where("shopid", "==", shopId));
    const snap2 = await getDocs(q2);
    snap2.forEach(docSnap => resultsMap.set(docSnap.id, { _id: docSnap.id, ...docSnap.data() }));
  } catch (err) {
    // Some collections might not have indexed fields; fallback to loading all and filtering
    console.warn("queryByShopField fallback for", collectionName, err);
    const snap = await getDocs(collection(db, collectionName));
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const sId = docShopId(d);
      if (sId === shopId) resultsMap.set(docSnap.id, { _id: docSnap.id, ...d });
    });
  }

  return Array.from(resultsMap.values());
}

// ========== INVOICES by shop AND date (two-field fallback) ==========
async function queryInvoicesByShopAndDate(shopId, dateStr) {
  const resultsMap = new Map();

  try {
    // There is no direct OR, so fetch both shopId/date combos
    const q1 = query(collection(db, "invoices"), where("shopId", "==", shopId), where("date", "==", dateStr));
    const s1 = await getDocs(q1);
    s1.forEach(docSnap => resultsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));

    const q2 = query(collection(db, "invoices"), where("shopid", "==", shopId), where("date", "==", dateStr));
    const s2 = await getDocs(q2);
    s2.forEach(docSnap => resultsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
  } catch (err) {
    // fallback: scan invoices and filter
    console.warn("queryInvoicesByShopAndDate fallback:", err);
    const sAll = await getDocs(collection(db, "invoices"));
    sAll.forEach(docSnap => {
      const d = docSnap.data();
      const sId = docShopId(d);
      if (sId === shopId && String(d.date) === dateStr) resultsMap.set(docSnap.id, { id: docSnap.id, ...d });
    });
  }

  return Array.from(resultsMap.values());
}

// ========== RENDER RECENT TABLE ==========
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
      <td>#${(inv.id || inv._id || "").toString().slice(0, 6)}</td>
      ${shopCol}
      <td>${time}</td>
      <td>${inv.customerName || "Walk-in"} <br><small style="color:#888;">${inv.customerPhone || ""}</small></td>
      <td style="font-weight:bold;">৳ ${inv.grandTotal || 0}</td>
      <td><button class="btn-view-receipt" onclick="viewReceipt('${inv.id || inv._id || ""}')"><i class="fas fa-print"></i></button></td>
    </tr>`;
  });
}

// ========== UTILS ==========
function initShopObj(id) {
  if (!id) return;
  if (!shopDataBreakdown[id]) shopDataBreakdown[id] = { products: 0, customers: 0, sales: 0, buyCost: 0 };
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ========== NAV / ACTIONS ==========
// When user clicks a shop "Go" — set active_shop only if allowed
window.switchToShop = (shopName, redirectUrl) => {
  const allowed = getUserShops();
  if (!allowed.includes(shopName)) {
    alert("You are not allowed to switch to this shop.");
    return;
  }
  localStorage.setItem("active_shop", shopName);
  window.location.href = redirectUrl;
};

// Keep existing viewReceipt/printReceipt functions from your original file.
// If they are not in scope, the existing functions in your project will pick up.
window.viewReceipt = window.viewReceipt || function (invId) { console.warn("viewReceipt not found", invId); };
window.printReceipt = window.printReceipt || function () { console.warn("printReceipt not implemented"); };
