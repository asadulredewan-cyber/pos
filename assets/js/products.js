/**
 * products.refactor.js
 * Refactored single-file product management logic
 *
 * Features:
 * - Layout init (expects initLayout imported)
 * - Firestore CRUD integration (expects `db` imported)
 * - Robust barcode countdown + multi-API lookup (sequential with per-request timeout)
 * - Image fetch -> base64 via a proxy fallback
 * - Clean UI helpers, form submit, edit/delete, and table render
 *
 * Replace: API_KEY_BARCODE_LOOKUP, API_KEY_EAN_SEARCH
 */

import { initLayout } from "./layout.js";
import { db } from "../../firebase/config.js";
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

initLayout("Product List");

/* ---------------------------
   CONFIG
   --------------------------- */
const API_KEY_BARCODE_LOOKUP = "YOUR_BARCODE_LOOKUP_KEY";
const API_KEY_EAN_SEARCH = "YOUR_EAN_SEARCH_KEY";
const COUNTDOWN_SECONDS = 8;
const UNKNOWN_SELECT_VALUE = "--- Select ---";
const IMAGE_PROXY = "https://api.allorigins.win/raw?url="; // lightweight proxy (can change)

/* category/unit mapping (tweakable) */
const CATEGORY_MAP = {
  beverage: "Grocery", milk: "Grocery", snack: "Grocery",
  "personal care": "Cosmetics", beauty: "Cosmetics",
  electronics: "Electronics", medicine: "Medicine"
};
const UNIT_MAP = {
  g: "gm", gram: "gm", kg: "kg", kilogram: "kg",
  ml: "ltr", liter: "ltr", l: "ltr",
  doz: "doz", box: "box", pkt: "pkt"
};

/* API sources (ordered) */
const APIS = [
  { name: "OpenFoodFacts", url: `https://world.openfoodfacts.org/api/v0/product/{BARCODE}.json` },
  { name: "UPCItemDB", url: `https://api.upcitemdb.com/prod/trial/lookup?upc={BARCODE}` },
  { name: "DataKick", url: `https://www.datakick.org/api/items/{BARCODE}` },
  { name: "EANSearch", url: `https://api.ean-search.org/api?op=barcode-lookup&ean={BARCODE}&key=${API_KEY_EAN_SEARCH}` },
  { name: "UPCDatabase", url: `https://api.upcdatabase.org/product/{BARCODE}` },
  { name: "OpenBeautyFacts", url: `https://world.openbeautyfacts.org/api/v0/product/{BARCODE}.json` },
  { name: "FoodRepo", url: `https://www.foodrepo.org/api/v0/products/{BARCODE}` },
  { name: "BarcodeLookup", url: `https://api.barcodelookup.com/v3/products?barcode={BARCODE}&formatted=y&key=${API_KEY_BARCODE_LOOKUP}` },
];

/* ---------------------------
   STATE & DOM REFS
   --------------------------- */
const currentShopId = localStorage.getItem("active_shop");
let currentUser = JSON.parse(localStorage.getItem("pos_user")) || {};
let countdownInterval = null;
let allProducts = [];

const modal = document.getElementById("productModal");
const tableBody = document.getElementById("productTableBody");
const form = document.getElementById("productForm");
const btnAddProduct = document.getElementById("btnAddProduct");
const pNameInput = document.getElementById("pName");
const barcodeInput = document.getElementById("pBarcode");
const pImageBase64 = document.getElementById("pImageBase64");
const pImageURL = document.getElementById("pImageURL");
const imagePreview = document.getElementById("imagePreview");
const loadingText = document.getElementById("loadingText");

/* ---------------------------
   SMALL HELPERS
   --------------------------- */
function $(id) { return document.getElementById(id); }

function safeSetText(elId, txt) {
  const el = document.getElementById(elId);
  if (el) el.innerText = txt;
}

function safeQuery(selector) {
  return document.querySelector(selector);
}

/* UI Helpers */
function updateImagePreview(base64Data) {
  const previewBox = imagePreview || document.getElementById("imagePreview");
  const deleteBtn = document.querySelector(".delete-image-btn");

  if (!previewBox) return;

  if (base64Data && base64Data !== 'none' && base64Data !== 'null') {
    previewBox.style.backgroundImage = `url(${base64Data})`;
    if (deleteBtn) deleteBtn.style.display = 'flex';
  } else {
    previewBox.style.backgroundImage = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
  }
}

function updateNameFieldUI(text, scanning = false) {
  const el = pNameInput || document.getElementById("pName");
  if (!el) return;
  el.placeholder = text;
  el.disabled = scanning;
}

function setDropdownsToUnknown() {
  const cat = $("pCategory"), unit = $("pUnit");
  if (cat) { cat.value = UNKNOWN_SELECT_VALUE; cat.style.borderColor = 'red'; }
  if (unit) { unit.value = UNKNOWN_SELECT_VALUE; unit.style.borderColor = 'red'; }
}

function setCategoryAndUnit(apiCat = "", apiUnit = "") {
  const pCategory = $("pCategory"), pUnit = $("pUnit");
  const cleanCat = (apiCat || "").toLowerCase().split(":")[0].trim();
  const finalCat = CATEGORY_MAP[cleanCat] || 'Others';

  if (pCategory && pCategory.querySelector(`option[value="${finalCat}"]`)) {
    pCategory.value = finalCat;
    pCategory.style.borderColor = '#ddd';
  } else if (pCategory) {
    pCategory.value = UNKNOWN_SELECT_VALUE;
    pCategory.style.borderColor = 'red';
  }

  const cleanUnit = (apiUnit || "").toLowerCase().split(" ")[0].trim();
  const finalUnit = UNIT_MAP[cleanUnit] || UNKNOWN_SELECT_VALUE;

  if (pUnit && pUnit.querySelector(`option[value="${finalUnit}"]`)) {
    pUnit.value = finalUnit;
    pUnit.style.borderColor = '#ddd';
  } else if (pUnit) {
    pUnit.value = UNKNOWN_SELECT_VALUE;
    pUnit.style.borderColor = 'red';
  }
}

/* map different API shapes to common object */
function mapApiData(data, apiName) {
  try {
    if (!data) return null;

    if ((apiName.includes("OpenFoodFacts") || apiName.includes("OpenBeautyFacts")) && data.product) {
      const p = data.product;
      return {
        name: p.product_name || p.generic_name || "",
        category: p.categories ? p.categories.split(",")[0] : "",
        unit: p.quantity || "",
        price: 0,
        imageUrl: p.image_url || p.image_front_url || null
      };
    }

    if (apiName.includes("UPCItemDB") && data.items && data.items.length) {
      const item = data.items[0];
      return {
        name: item.title || "",
        category: item.category || "",
        unit: 'pcs',
        price: item.lowest_recorded_price || 0,
        imageUrl: item.images && item.images.length ? item.images[0] : null
      };
    }

    if (apiName.includes("BarcodeLookup") && data.products && data.products.length) {
      const item = data.products[0];
      return {
        name: item.product_name || "",
        category: item.category || "",
        unit: item.size || 'pcs',
        price: item.lowest_recorded_price || 0,
        imageUrl: item.images && item.images.length ? item.images[0].url || item.images[0] : null
      };
    }

    if (apiName.includes("DataKick") && data.name) {
      return {
        name: data.name,
        category: data.category || "",
        unit: data.unit || "pcs",
        price: 0,
        imageUrl: data.image || null
      };
    }

    if (apiName.includes("EANSearch") && data.result && data.result[0]) {
      const r = data.result[0];
      return {
        name: r.title || r.name || "",
        category: r.category || "",
        unit: r.size || "pcs",
        price: r.price || 0,
        imageUrl: r.image || null
      };
    }

    // Generic fallback attempts
    if (data.name || data.title) {
      return {
        name: data.name || data.title || "",
        category: data.category || "",
        unit: data.unit || "pcs",
        price: data.price || 0,
        imageUrl: data.image || data.image_url || null
      };
    }
  } catch (err) {
    console.warn("mapApiData error", err);
  }
  return null;
}

/* safe fetch with timeout */
async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, ...options });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/* convert remote image to dataURL (base64) via proxy attempt */
async function imageToDataURL(url) {
  if (!url) return null;
  try {
    const proxied = `${IMAGE_PROXY}${encodeURIComponent(url)}`;
    const res = await fetchWithTimeout(proxied, {}, 9000);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("imageToDataURL failed:", err);
    return null;
  }
}

/* ---------------------------
   RENDERING & LOADING
   --------------------------- */
function renderTable(products) {
  if (!tableBody) return;
  tableBody.innerHTML = "";
  products.forEach(p => {
    const img = p.image || p.base64Image || "https://placehold.co/40";
    const unit = p.unit || "pcs";
    const barcode = p.barcode ? `<br><small style="color:#666; font-size:11px;"><i class="fas fa-barcode"></i> ${p.barcode}</small>` : "";
    const lowStockLimit = p.lowAlert || 5;
    const stockStyle = (p.stock <= lowStockLimit) ? "color:red; font-weight:bold;" : "color:green;";

    let actionButtons;
    if (currentUser.role === 'seller') {
      actionButtons = '<span style="color:#aaa; font-size:12px;">No Access</span>';
    } else {
      actionButtons = `
        <button class="btn-action btn-edit" data-id="${p.id}"><i class="fas fa-edit"></i></button>
        <button class="btn-action btn-delete" data-id="${p.id}"><i class="fas fa-trash"></i></button>
      `;
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><img src="${img}" class="table-img"></td>
      <td>${escapeHtml(p.name || "")}${barcode}</td>
      <td>${escapeHtml(p.category || "")}</td>
      <td>${p.buyPrice || 0}</td>
      <td>${p.sellPrice || 0}</td>
      <td style="${stockStyle}">${p.stock || 0} <span style="font-size:11px; color:#555;">${unit}</span></td>
      <td>${actionButtons}</td>
    `;
    tableBody.appendChild(row);
  });

  // Attach delegated listeners for edit/delete buttons
  tableBody.querySelectorAll(".btn-edit").forEach(b => b.addEventListener("click", (ev) => {
    const id = ev.currentTarget.getAttribute("data-id");
    window.editProduct && window.editProduct(id);
  }));
  tableBody.querySelectorAll(".btn-delete").forEach(b => b.addEventListener("click", (ev) => {
    const id = ev.currentTarget.getAttribute("data-id");
    window.deleteProduct && window.deleteProduct(id);
  }));
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* Load products for active shop */
async function loadProducts() {
  if (!currentShopId || currentShopId === "all") {
    safeSetText("loadingText", currentShopId === "all" ? "অনুগ্রহ করে একটি নির্দিষ্ট দোকান সিলেক্ট করুন ডাটা দেখার জন্য।" : "দোকান সিলেক্ট করা নেই!");
    if (document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "none";
    return;
  }

  if (currentUser.role !== 'seller' && document.querySelector(".btn-add")) {
    document.querySelector(".btn-add").style.display = "block";
  }

  try {
    safeSetText("loadingText", "লোড হচ্ছে...");
    const q = query(collection(db, "products"), where("shopId", "==", currentShopId));
    const snapshot = await getDocs(q);
    allProducts = [];
    snapshot.forEach(d => allProducts.push({ id: d.id, ...d.data() }));

    if (allProducts.length === 0) {
      safeSetText("loadingText", "কোনো পণ্য পাওয়া যায়নি।");
      if (tableBody) tableBody.innerHTML = "";
      return;
    }
    loadingText.style.display = "none";
    renderTable(allProducts);
  } catch (err) {
    console.error("Load Products Error:", err);
    safeSetText("loadingText", "ডাটা লোড করতে সমস্যা হয়েছে।");
  }
}

/* ---------------------------
   BARCODE COUNTDOWN + LOOKUP
   --------------------------- */

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

window.startBarcodeLookup = () => {
  if (!barcodeInput) return;
  // Only trigger when barcode input is focused OR small screen scan button
  if (document.activeElement !== barcodeInput && window.matchMedia("(min-width: 769px)").matches &&
      !document.activeElement.id.includes('mobileScanBtn')) {
    return;
  }
  const barcode = barcodeInput.value.trim();
  if (barcode.length < 8) return;
  startCountdownAndLookup(barcode);
}

async function startCountdownAndLookup(barcode) {
  clearCountdown();
  let timeLeft = COUNTDOWN_SECONDS;
  updateNameFieldUI(`স্ক্যান হচ্ছে... (${timeLeft})`, true);
  barcodeInput.style.borderColor = "orange";

  countdownInterval = setInterval(() => {
    timeLeft--;
    updateNameFieldUI(`স্ক্যান হচ্ছে... (${timeLeft})`, true);
    if (timeLeft <= 0) {
      clearCountdown();
      lookupFromAllAPIs(barcode);
    }
  }, 1000);
}

/* Try APIs sequentially; return first useful result */
async function lookupFromAllAPIs(barcode) {
  updateNameFieldUI("ডেটা খোঁজা হচ্ছে...", true);
  barcodeInput.style.borderColor = "#ddd";

  let bestData = null;

  for (const api of APIS) {
    const url = api.url.replace("{BARCODE}", encodeURIComponent(barcode));
    try {
      const res = await fetchWithTimeout(url, {}, 7000);
      const json = await res.json();
      const mapped = mapApiData(json, api.name);
      if (mapped && mapped.name) {
        bestData = mapped;
        break; // stop on first valid
      }
    } catch (err) {
      console.warn(`API ${api.name} failed for ${barcode}:`, err);
      // continue to next API
    }
  }

  await handleLookupResult(bestData);
}

/* result handler */
async function handleLookupResult(data) {
  updateNameFieldUI("পণ্যের নাম লিখুন", false);
  barcodeInput.style.borderColor = '#ddd';

  if (data && data.name) {
    pNameInput.value = data.name;
    $("pPrice") && ($("pPrice").value = (Number(data.price || 0)).toFixed(2));
    pImageURL && (pImageURL.value = "");
    pImageBase64 && (pImageBase64.value = "");

    setCategoryAndUnit(data.category, data.unit);

    if (data.imageUrl) {
      const base64 = await imageToDataURL(data.imageUrl);
      if (base64) {
        pImageBase64.value = base64;
        updateImagePreview(base64);
      } else if (pImageURL) {
        pImageURL.value = data.imageUrl;
      }
    }
  } else {
    alert("বারকোড খুঁজে পাওয়া যায়নি। ম্যানুয়ালি তথ্য দিন।");
    setDropdownsToUnknown();
  }
}

/* ---------------------------
   CRUD / FORM SUBMISSION
   --------------------------- */

window.openProductModal = () => {
  if (!form) return;
  form.reset();
  $("editProductId") && ($("editProductId").value = "");
  $("pCategory") && ($("pCategory").value = UNKNOWN_SELECT_VALUE);
  $("pUnit") && ($("pUnit").value = UNKNOWN_SELECT_VALUE);
  $("pLowAlert") && ($("pLowAlert").value = "5");
  updateImagePreview(null);
  pNameInput && (pNameInput.placeholder = "পণ্যের নাম লিখুন");
  $("modalTitle") && ($("modalTitle").innerText = "নতুন পণ্য যোগ করুন");
  modal && (modal.style.display = "flex");
};

window.closeProductModal = () => modal && (modal.style.display = "none");

form && form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.querySelector(".btn-save");
  if (!btn) return;
  const originalText = btn.innerText;
  btn.innerText = "Checking...";

  const id = $("editProductId") ? $("editProductId").value : "";
  const barcode = barcodeInput ? barcodeInput.value.trim() : "";

  // Barcode uniqueness check
  if (barcode) {
    try {
      const barcodeCheckQuery = query(collection(db, "products"), where("barcode", "==", barcode));
      const checkSnapshot = await getDocs(barcodeCheckQuery);
      if (!checkSnapshot.empty) {
        const existingProduct = checkSnapshot.docs[0];
        if (existingProduct.id !== id) {
          alert(`এই বারকোডটি (${barcode}) অন্য একটি পণ্যের জন্য ইতিমধ্যেই ব্যবহৃত হয়েছে।`);
          btn.innerText = originalText;
          return;
        }
      }
    } catch (err) {
      console.warn("Barcode check error:", err);
    }
  }

  // Required dropdowns
  if (($("pCategory") && $("pCategory").value === UNKNOWN_SELECT_VALUE) ||
      ($("pUnit") && $("pUnit").value === UNKNOWN_SELECT_VALUE)) {
    alert("ক্যাটাগরি বা ইউনিট নির্বাচন করুন!");
    btn.innerText = originalText;
    return;
  }

  const finalImageValue = (pImageBase64 && pImageBase64.value) || (pImageURL && pImageURL.value) || null;

  const data = {
    name: (pNameInput && pNameInput.value.trim()) || "",
    barcode: barcode,
    category: ($("pCategory") && $("pCategory").value) || "",
    unit: ($("pUnit") && $("pUnit").value) || "",
    stock: Number($("pStock") ? $("pStock").value : 0),
    lowAlert: Number($("pLowAlert") ? $("pLowAlert").value : 5),
    buyPrice: Number($("pCost") ? $("pCost").value : 0),
    sellPrice: Number($("pPrice") ? $("pPrice").value : 0),
    image: finalImageValue,
    shopId: currentShopId
  };

  btn.innerText = "Saving...";

  try {
    if (id) {
      await updateDoc(doc(db, "products", id), data);
      alert("আপডেট হয়েছে!");
    } else {
      await addDoc(collection(db, "products"), data);
      alert("নতুন পণ্য যোগ হয়েছে!");
    }
    closeProductModal();
    await loadProducts();
  } catch (error) {
    console.error("Save error:", error);
    alert("সমস্যা হয়েছে: " + (error.message || error));
  } finally {
    btn.innerText = originalText;
  }
});

/* Edit/Delete (attached to window so buttons in markup can call them) */
window.editProduct = (id) => {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  $("editProductId") && ($("editProductId").value = p.id);
  pNameInput && (pNameInput.value = p.name || "");
  barcodeInput && (barcodeInput.value = p.barcode || "");
  $("pCategory") && ($("pCategory").value = p.category || UNKNOWN_SELECT_VALUE);
  $("pUnit") && ($("pUnit").value = p.unit || UNKNOWN_SELECT_VALUE);
  $("pStock") && ($("pStock").value = p.stock || 0);
  $("pLowAlert") && ($("pLowAlert").value = p.lowAlert || 5);
  $("pCost") && ($("pCost").value = p.buyPrice || 0);
  $("pPrice") && ($("pPrice").value = p.sellPrice || 0);

  updateImagePreview(p.image || null);
  if (p.image && p.image.startsWith('data:')) {
    pImageBase64 && (pImageBase64.value = p.image);
  } else {
    pImageURL && (pImageURL.value = p.image || "");
  }

  $("modalTitle") && ($("modalTitle").innerText = "পণ্য আপডেট করুন");
  modal && (modal.style.display = "flex");
};

window.deleteProduct = async (id) => {
  if (currentUser.role === 'seller') {
    alert("সেলার পণ্য ডিলিট করতে পারবে না!");
    return;
  }
  if (!confirm("আপনি কি নিশ্চিত এই পণ্যটি ডিলিট করতে চান?")) return;
  try {
    await deleteDoc(doc(db, "products", id));
    await loadProducts();
  } catch (err) {
    console.error("Delete failed:", err);
    alert("ডিলিট করা যায়নি!");
  }
};

/* ---------------------------
   UTIL / INIT
   --------------------------- */
function initEventShortcuts() {
  // barcode input enter triggers lookup immediately
  barcodeInput && barcodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = barcodeInput.value.trim();
      if (code.length >= 8) lookupFromAllAPIs(code);
    }
  });

  // image URL -> preview convert button (if exists)
  const btnFetchImage = document.querySelector(".btn-fetch-image");
  if (btnFetchImage) {
    btnFetchImage.addEventListener("click", async () => {
      if (!pImageURL) return;
      const url = pImageURL.value.trim();
      if (!url) return alert("Image URL দিন।");
      btnFetchImage.disabled = true;
      const base64 = await imageToDataURL(url);
      if (base64) {
        if (pImageBase64) pImageBase64.value = base64;
        updateImagePreview(base64);
      } else {
        alert("Image fetch failed.");
      }
      btnFetchImage.disabled = false;
    });
  }

  // delete-image-simple
  const delBtn = document.querySelector(".delete-image-btn");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      if (pImageBase64) pImageBase64.value = "";
      if (pImageURL) pImageURL.value = "";
      updateImagePreview(null);
    });
  }
}

(async function init() {
  initEventShortcuts();
  await loadProducts();
})();

/* End of file */
