import { initLayout } from "./layout.js";
import { db } from "../../firebase/config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 1. Initialize Layout
initLayout("Dashboard");

// Global State
const currentShopId = localStorage.getItem("active_shop");
let shopDataBreakdown = {}; 
let recentSalesList = []; // আজকের সেলস লিস্ট রাখার জন্য

// 2. Load Data
loadDashboardData();

// Listen for Shop Change
window.addEventListener("shop-changed", () => {
    window.location.reload();
});

// ===================================
// MAIN DATA LOADING
// ===================================
async function loadDashboardData() {
    if (!currentShopId) return;
    document.getElementById("todaySalesAmount").innerText = "Loading...";
    
    if (currentShopId === 'all') {
        await fetchAllShopsData();
    } else {
        await fetchSingleShopData(currentShopId);
    }
}

// -----------------------------------
// A. SINGLE SHOP DATA
// -----------------------------------
async function fetchSingleShopData(shopId) {
    // Products Count
    const pQ = query(collection(db, "products"), where("shopId", "==", shopId));
    const pSnap = await getDocs(pQ);
    document.getElementById("totalProductsCount").innerText = pSnap.size + " টি";

    // Customers Count
    const cQ = query(collection(db, "customers"), where("shopId", "==", shopId));
    const cSnap = await getDocs(cQ);
    document.getElementById("totalCustomersCount").innerText = cSnap.size + " জন";

    // Today's Sales
    const today = new Date();
    const dateStr = formatDate(today); // Local Date Helper

    // Invoices Query
    const sQ = query(collection(db, "invoices"), where("shopId", "==", shopId), where("date", "==", dateStr));
    const sSnap = await getDocs(sQ);
    
    let totalSale = 0;
    recentSalesList = []; // Reset list

    sSnap.forEach(doc => {
        const d = doc.data();
        totalSale += Number(d.grandTotal || 0);
        // Add to list for table
        recentSalesList.push({ id: doc.id, ...d });
    });
    
    document.getElementById("todaySalesAmount").innerText = "৳ " + totalSale.toLocaleString();
    
    // Render Recent Table (Single Shop)
    renderRecentSalesTable(recentSalesList, false); 
}

// -----------------------------------
// B. ALL SHOPS DATA
// -----------------------------------
async function fetchAllShopsData() {
    shopDataBreakdown = {}; 
    recentSalesList = []; // Reset list

    // 1. Products (All)
    const pSnap = await getDocs(collection(db, "products"));
    let totalProd = 0;
    pSnap.forEach(doc => {
        const d = doc.data();
        // Check both shopId and shopid
        const sId = d.shopId || d.shopid || "Unknown"; 
        if(!shopDataBreakdown[sId]) initShopObj(sId);
        shopDataBreakdown[sId].products += 1;
        totalProd++;
    });
    document.getElementById("totalProductsCount").innerText = totalProd + " টি";

    // 2. Customers (All)
    const cSnap = await getDocs(collection(db, "customers"));
    let totalCus = 0;
    cSnap.forEach(doc => {
        const d = doc.data();
        const sId = d.shopId || d.shopid || "Unknown";
        if(!shopDataBreakdown[sId]) initShopObj(sId);
        shopDataBreakdown[sId].customers += 1;
        totalCus++;
    });
    document.getElementById("totalCustomersCount").innerText = totalCus + " জন";

    // 3. Today's Sales (All)
    const today = new Date();
    const dateStr = formatDate(today);

    // Fetch all invoices for today
    const sQ = query(collection(db, "invoices"), where("date", "==", dateStr));
    const sSnap = await getDocs(sQ);
    
    let totalSale = 0;
    let totalBuyCost = 0;

    sSnap.forEach(doc => {
        const d = doc.data();
        const sId = d.shopId || d.shopid || "Unknown";
        
        if(!shopDataBreakdown[sId]) initShopObj(sId);

        const sale = Number(d.grandTotal || 0);
        const profit = Number(d.totalProfit || 0);
        const cost = (Number(d.subTotal || sale) - profit); 

        shopDataBreakdown[sId].sales += sale;
        shopDataBreakdown[sId].buyCost += cost;

        totalSale += sale;
        totalBuyCost += cost;

        // Add to recent list
        recentSalesList.push({ id: doc.id, ...d });
    });

    document.getElementById("todaySalesAmount").innerText = "৳ " + totalSale.toLocaleString();
    document.getElementById("salesBuyInfo").innerText = `(মোট কেনা খরচ: ৳ ${totalBuyCost.toLocaleString()})`;
    
    // Render Recent Table (All Shop Mode -> Show Shop Name)
    renderRecentSalesTable(recentSalesList, true);
}

// -----------------------------------
// RENDER RECENT TABLE
// -----------------------------------
function renderRecentSalesTable(data, showShopName) {
    const thead = document.getElementById("recentTableHead");
    const tbody = document.getElementById("recentTableBody");
    const notice = document.getElementById("recentInfoText");

    tbody.innerHTML = "";
    
    // Sort by timestamp (descending) & take last 6
    // Note: If timestamp missing, fallback to date
    data.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    const last6 = data.slice(0, 6);

    notice.innerText = `সর্বশেষ ${last6.length}টি ইনভয়েস দেখানো হচ্ছে`;

    // Dynamic Header
    let shopHeader = showShopName ? `<th>দোকান</th>` : ``;
    thead.innerHTML = `
        <tr>
            <th>অর্ডার আইডি</th>
            ${shopHeader}
            <th>সময়</th>
            <th>কাস্টমার</th>
            <th>মোট</th>
            <th>একশন</th>
        </tr>
    `;

    if(last6.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${showShopName?6:5}" style="text-align:center; padding:20px;">আজকের কোনো সেলস নেই</td></tr>`;
        return;
    }

    last6.forEach(inv => {
        let time = "-";
        if(inv.timestamp) {
            const d = new Date(inv.timestamp.toDate());
            time = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        let shopCol = showShopName ? `<td><span class="badge" style="background:#e0f2fe; color:#0284ff;">${inv.shopId || inv.shopid}</span></td>` : ``;

        const row = `
            <tr>
                <td>#${inv.id.slice(0, 6)}</td>
                ${shopCol}
                <td>${time}</td>
                <td>${inv.customerName} <br> <small style="color:#888">${inv.customerPhone || ''}</small></td>
                <td style="font-weight:bold;">৳ ${inv.grandTotal}</td>
                <td>
                    <button class="btn-view-receipt" onclick="viewReceipt('${inv.id}')">
                        <i class="fas fa-print"></i>
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

// -----------------------------------
// HANDLE CARD CLICK (Window Scope)
// -----------------------------------
window.handleCardClick = (type) => {
    // Single Shop -> Direct Redirect
    if (currentShopId !== 'all') {
        if (type === 'sales') window.location.href = "reports.html";
        else if (type === 'products') window.location.href = "products.html";
        else if (type === 'customers') window.location.href = "customers.html";
        return;
    }

    // All Shops -> Open Modal
    const modal = document.getElementById("listModal");
    const thead = document.getElementById("listModalHead");
    const tbody = document.getElementById("listModalBody");
    const title = document.getElementById("listModalTitle");

    modal.style.display = "flex"; // Center modal
    tbody.innerHTML = "";

    if (type === 'sales') {
        title.innerText = "আজকের বিক্রয় (দোকান ভিত্তিক)";
        thead.innerHTML = `<tr><th style="padding:10px;">দোকান</th><th>কেনা </th><th>বিক্রয় </th><th>Action</th></tr>`;
        Object.keys(shopDataBreakdown).forEach(shop => {
            const d = shopDataBreakdown[shop];
            tbody.innerHTML += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;"><b>${shop}</b></td>
                    <td style="color:#d63031;">৳ ${d.buyCost.toLocaleString()}</td>
                    <td style="color:#00b894; font-weight:bold;">৳ ${d.sales.toLocaleString()}</td>
                    <td><button onclick="switchToShop('${shop}', 'reports.html')" style="padding:5px 10px; background:#0d1b2a; color:white; border:none; cursor:pointer; border-radius:4px;">Go</button></td>
                </tr>`;
        });
    } else if (type === 'products') {
        title.innerText = "মোট পণ্য (দোকান ভিত্তিক)";
        thead.innerHTML = `<tr><th style="padding:10px;">দোকান</th><th>মোট পণ্য</th><th>Action</th></tr>`;
        Object.keys(shopDataBreakdown).forEach(shop => {
            tbody.innerHTML += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;"><b>${shop}</b></td>
                    <td>${shopDataBreakdown[shop].products} টি</td>
                    <td><button onclick="switchToShop('${shop}', 'products.html')" style="padding:5px 10px; background:#0d1b2a; color:white; border:none; cursor:pointer; border-radius:4px;">Go</button></td>
                </tr>`;
        });
    } else if (type === 'customers') {
        title.innerText = "মোট কাস্টমার (দোকান ভিত্তিক)";
        thead.innerHTML = `<tr><th style="padding:10px;">দোকান</th><th>মোট কাস্টমার</th><th>Action</th></tr>`;
        Object.keys(shopDataBreakdown).forEach(shop => {
            tbody.innerHTML += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;"><b>${shop}</b></td>
                    <td>${shopDataBreakdown[shop].customers} জন</td>
                    <td><button onclick="switchToShop('${shop}', 'customers.html')" style="padding:5px 10px; background:#0d1b2a; color:white; border:none; cursor:pointer; border-radius:4px;">Go</button></td>
                </tr>`;
        });
    }
};

window.switchToShop = (shopName, redirectUrl) => {
    localStorage.setItem("active_shop", shopName);
    window.location.href = redirectUrl;
};

// --- RECEIPT LOGIC (Copy from Reports) ---// ===================================
// 5. VIEW RECEIPT (POS STYLE MATCHED)
// ===================================
window.viewReceipt = (invId) => {
    const inv = recentSalesList.find(x => x.id === invId);
    if (!inv) return;
    
    document.getElementById("receiptModal").style.display = "flex"; // CSS এ flex আছে
    const receiptDiv = document.getElementById("receiptContent");
    
    // তারিখ ফরম্যাটিং
    let dateStr = inv.date;
    let timeStr = "";
    if (inv.timestamp) {
        const d = new Date(inv.timestamp.toDate());
        dateStr = d.toLocaleDateString('en-US');
        timeStr = d.toLocaleTimeString('en-US');
    }
    
    // আইটেম লুপ
    let itemsHtml = inv.cartItems.map(item => `
        <tr>
            <td colspan="2" style="font-weight:500; padding-bottom:2px;">${item.name} x${item.qty}</td>
            <td class="text-right">${(item.price * item.qty).toFixed(2)}</td>
        </tr>
    `).join("");

    // HTML Structure (Exact match with Reports/POS)
    receiptDiv.innerHTML = `
        <div class="receipt-header">
            <h2 style="margin:0; font-size:22px; font-weight:bold; color:#000;">MySolution POS</h2>
            <p style="font-size:14px; margin:2px 0;">রিসিট</p>
            <p style="font-size:12px; margin:2px 0;">অর্ডার আইডি: ${inv.id.slice(0, 8)}</p>
            <p style="font-size:12px; margin:2px 0;">তারিখ: ${dateStr}, ${timeStr}</p>
            <p style="font-size:12px; margin:2px 0;">স্টোর: ${inv.shopId || inv.shopid || currentShopId}</p>
        </div>
        
        <div class="dashed-line" style="border-top:1px dashed #333; margin:10px 0;"></div>
        
        <div style="text-align:left; font-size:13px; line-height:1.4; color:#000;">
            <div><b>কাস্টমার:</b> ${inv.customerName || 'Walk-in'}</div>
            <div><b>ফোন:</b> ${inv.customerPhone || '-'}</div>
        </div>

        <div class="dashed-line" style="border-top:1px dashed #333; margin:10px 0;"></div>
        <div style="text-align:left; font-weight:bold; font-size:13px; margin-bottom:5px;">আইটেমস:</div>

        <table class="receipt-table" style="width:100%; font-size:13px; text-align:left; color:#000;">
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>

        <div class="dashed-line" style="border-top:1px dashed #333; margin:10px 0;"></div>

        <div class="total-row" style="display:flex; justify-content:space-between; font-weight:bold; font-size:13px; color:#000;">
            <span>সাবটোটাল:</span>
            <span>৳ ${Math.round(inv.subTotal || inv.grandTotal)}</span>
        </div>
        <div class="total-row" style="display:flex; justify-content:space-between; font-size:13px; color:#000;">
            <span>ভ্যাট (0%):</span>
            <span>৳ 0</span>
        </div>
        <div class="total-row" style="display:flex; justify-content:space-between; font-size:13px; color:#000;">
            <span>মোট বিল:</span>
            <span>৳ ${Math.round(inv.subTotal || inv.grandTotal)}</span>
        </div>
        
        ${inv.discount > 0 ? `
        <div class="total-row" style="display:flex; justify-content:space-between; font-size:13px; color:#000;">
            <span>ডিসকাউন্ট:</span>
            <span>- ৳ ${Number(inv.discount).toFixed(2)}</span>
        </div>` : ''}
        
        <div class="dashed-line" style="border-top:1px dashed #333; margin:10px 0;"></div>

        <div class="total-row" style="display:flex; justify-content:space-between; font-size:18px; font-weight:bold; color:#000;">
            <span>পরিশোধিত:</span>
            <span>৳ ${inv.grandTotal.toFixed(2)}</span>
        </div>

        <div class="dashed-line" style="border-top:1px dashed #333; margin:10px 0;"></div>

        ${inv.cashReceived > 0 ? `
        <div class="total-row" style="display:flex; justify-content:space-between; font-size:13px; margin-top:5px; color:#000;">
            <span>নগদ:</span>
            <span>৳ ${inv.cashReceived}</span>
        </div>
        <div class="total-row" style="display:flex; justify-content:space-between; font-size:13px; color:#000;">
            <span>ফেরত:</span>
            <span>৳ ${Number(inv.changeAmount).toFixed(2)}</span>
        </div>` : ''}

        <br>
        <p style="font-size:14px; font-weight:bold; margin-top:10px; color:#000;">ধন্যবাদ, আবার আসবেন!</p>
    `;
};

// প্রিন্ট ফাংশন (আগের মতোই থাকবে)
window.printReceipt = () => {
    const content = document.getElementById("receiptContent").innerHTML;
    const win = window.open('', '', 'height=600,width=400');
    win.document.write('<html><head><title>Receipt</title><style>body { font-family: "Arial", sans-serif; text-align: center; margin: 0; padding: 10px; } .dashed-line { border-top: 1px dashed #333; margin: 8px 0; width: 100%; } .receipt-table { width: 100%; text-align: left; font-size: 13px; } .text-right { text-align: right; } .total-row { display: flex; justify-content: space-between; font-weight: bold; margin-top: 3px; font-size: 13px; } h2 { margin: 0; font-size: 22px; } p { margin: 2px 0; font-size: 12px; }</style></head><body>');
    win.document.write(content);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
};

window.printReceipt = () => {
    const content = document.getElementById("receiptContent").innerHTML;
    const win = window.open('', '', 'height=600,width=400');
    win.document.write(`<html><body style="text-align:center; font-family:Arial;">${content}</body></html>`);
    win.document.close();
    win.print();
};

function initShopObj(id) {
    shopDataBreakdown[id] = { products: 0, customers: 0, sales: 0, buyCost: 0 };
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}