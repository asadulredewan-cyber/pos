import { initLayout } from "./layout.js";
import { db } from "../../firebase/config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 1. Initialize Layout
initLayout("Reports & Analytics");

const currentShopId = localStorage.getItem("active_shop");
let globalInvoices = []; 
let isSingleDay = true; 

// ============================================
// 1. INVENTORY SUMMARY
// ============================================
async function loadInventoryStats() {
    if (!currentShopId) return;

    let q;
    if (currentShopId === 'all') {
        q = query(collection(db, "products"));
    } else {
        // shopId (CamelCase)
        q = query(collection(db, "products"), where("shopId", "==", currentShopId));
    }
    
    try {
        const snapshot = await getDocs(q);
        let totalQty = 0, totalBuy = 0, totalSell = 0;

        snapshot.forEach(doc => {
            const p = doc.data();
            const stock = Number(p.stock) || 0;
            totalQty += stock;
            totalBuy += (Number(p.stock) || 0) * (Number(p.buyPrice) || 0);
            totalSell += (Number(p.stock) || 0) * (Number(p.sellPrice) || 0);
        });

        const estimatedProfit = totalSell - totalBuy;

        document.getElementById("totalStockQty").innerText = totalQty;
        document.getElementById("totalStockCost").innerText = "৳ " + totalBuy.toLocaleString();
        document.getElementById("totalStockSell").innerText = "৳ " + totalSell.toLocaleString();
        document.getElementById("totalStockProfit").innerText = "৳ " + estimatedProfit.toLocaleString();

    } catch (error) {
        console.error("Inventory Error:", error);
    }
}

// ============================================
// 2. SALES REPORT (With Cost Calculation)
// ============================================
window.loadSalesReport = async (type, btnElement) => {
    if(btnElement) {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        btnElement.classList.add("active");
    }

    if (!currentShopId) return;

    let startDateStr = "", endDateStr = "";
    const today = new Date();

    if (type === 'today') {
        isSingleDay = true;
        startDateStr = formatDate(today);
        endDateStr = startDateStr;
    } else {
        isSingleDay = false;
        if (type === 'month') {
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            startDateStr = formatDate(firstDay);
            endDateStr = formatDate(lastDay);
        } else if (type === 'custom') {
            startDateStr = document.getElementById("startDate").value;
            endDateStr = document.getElementById("endDate").value;
            if(!startDateStr || !endDateStr) { alert("তারিখ দিন!"); return; }
            if (startDateStr === endDateStr) isSingleDay = true;
        }
    }

    let q;
    if (currentShopId === 'all') {
        q = query(
            collection(db, "invoices"), 
            where("date", ">=", startDateStr),
            where("date", "<=", endDateStr)
        );
    } else {
        // Specific Shop: Fetch all by ShopId, Filter Date in JS (No Index Error)
        q = query(collection(db, "invoices"), where("shopId", "==", currentShopId));
    }

    try {
        const snapshot = await getDocs(q);
        globalInvoices = []; 
        let salesTotal = 0, salesProfit = 0, salesCost = 0, count = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Client Side Date Filtering (For Specific Shop)
            if (currentShopId !== 'all') {
                if (data.date < startDateStr || data.date > endDateStr) return;
            }

            globalInvoices.push({ id: doc.id, ...data });
            
            const gTotal = Number(data.grandTotal || 0);
            const profit = Number(data.totalProfit || 0);

            salesTotal += gTotal;
            salesProfit += profit;
            
            // 🔥 FIXED: Cost Calculation (Sales - Profit = Cost)
            salesCost += (gTotal - profit);

            count++;
        });

        // UI Update
        document.getElementById("salesTotal").innerText = "৳ " + salesTotal.toLocaleString();
        document.getElementById("salesProfit").innerText = "৳ " + salesProfit.toLocaleString();
        
        // Cost Update
        if(document.getElementById("salesCost")) {
            document.getElementById("salesCost").innerText = "৳ " + salesCost.toLocaleString();
        }
        
        document.getElementById("salesCount").innerText = count;

    } catch (error) {
        console.error("Sales Error:", error);
    }
};

// ============================================
// 3. DRILL DOWN DETAILS
// ============================================
window.openDetailsModal = () => {
    document.getElementById("reportDetailModal").style.display = "flex";
    if (globalInvoices.length === 0) {
        document.getElementById("reportTableBody").innerHTML = "<tr><td colspan='5' align='center'>কোনো ডাটা নেই</td></tr>";
        return;
    }
    if (isSingleDay) renderInvoiceList(globalInvoices, globalInvoices[0]?.date || "Date", false);
    else renderDayWiseTable();
};

window.renderDayWiseTable = () => {
    const tbody = document.getElementById("reportTableBody");
    const thead = document.getElementById("reportTableHead");
    document.getElementById("btnBackToDays").style.display = "none";
    document.getElementById("reportModalTitle").innerText = "দিন ভিত্তিক হিসাব";

    thead.innerHTML = `<tr><th>তারিখ</th><th>মোট সেলস</th><th>মোট লাভ</th><th>অ্যাকশন</th></tr>`;
    tbody.innerHTML = "";

    const grouped = {};
    globalInvoices.forEach(inv => {
        if (!grouped[inv.date]) grouped[inv.date] = { sales: 0, profit: 0, list: [] };
        grouped[inv.date].sales += Number(inv.grandTotal || 0);
        grouped[inv.date].profit += Number(inv.totalProfit || 0);
        grouped[inv.date].list.push(inv);
    });

    Object.keys(grouped).sort().reverse().forEach(date => {
        const d = grouped[date];
        const row = document.createElement("tr");
        row.innerHTML = `<td>${date}</td><td><b>৳ ${d.sales.toFixed(2)}</b></td><td style="color:green">৳ ${d.profit.toFixed(2)}</td><td><i class="fas fa-arrow-right"></i></td>`;
        row.onclick = () => renderInvoiceList(d.list, date, true);
        tbody.appendChild(row);
    });
};

window.renderInvoiceList = (invoices, dateLabel, showBack) => {
    const tbody = document.getElementById("reportTableBody");
    const thead = document.getElementById("reportTableHead");
    const backBtn = document.getElementById("btnBackToDays");
    
    backBtn.style.display = showBack ? "block" : "none";
    document.getElementById("reportModalTitle").innerText = `লিস্ট (${dateLabel})`;

    let shopHead = currentShopId === 'all' ? `<th>দোকান</th>` : ``;
    thead.innerHTML = `<tr><th>ID</th>${shopHead}<th>কাস্টমার</th><th>টাকা</th><th>রিসিট</th></tr>`;
    tbody.innerHTML = "";

    invoices.forEach(inv => {
        let shopCol = currentShopId === 'all' ? `<td><small>${inv.shopId || inv.shopid}</small></td>` : ``;
        let time = inv.timestamp ? new Date(inv.timestamp.toDate()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
        
        const row = document.createElement("tr");
        row.innerHTML = `<td><small>#${inv.id.slice(0,6)}</small></td>${shopCol}<td>${inv.customerName}</td><td><b>${inv.grandTotal}</b></td><td><button class="btn-view-receipt" onclick="event.stopPropagation(); viewReceipt('${inv.id}')"><i class="fas fa-file-invoice"></i></button></td>`;
        tbody.appendChild(row);
    });
};

// ============================================
// 4. RECEIPT GENERATOR
// ============================================
window.viewReceipt = (invId) => {
    const inv = globalInvoices.find(x => x.id === invId);
    if (!inv) return;
    document.getElementById("receiptModal").style.display = "flex";
    
    const content = document.getElementById("receiptContent");
    
    let dateStr = inv.date;
    let timeStr = inv.timestamp ? new Date(inv.timestamp.toDate()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : "";

    let itemsHtml = inv.cartItems.map(i => `<tr><td>${i.name} x${i.qty}</td><td class="text-right">${(i.price*i.qty).toFixed(2)}</td></tr>`).join("");
    
    content.innerHTML = `
        <div style="font-family:'Courier New'; text-align:center;">
            <h2 style="margin:0;">MySolution POS</h2>
            <p>Shop: ${inv.shopId || inv.shopid || currentShopId}</p>
            <p style="font-size:12px;">Date: ${dateStr} ${timeStr}</p>
            <div class="dashed-line"></div>
            <p style="text-align:left; font-size:12px;"><b>Inv:</b> #${inv.id.slice(0,8).toUpperCase()}<br><b>Cus:</b> ${inv.customerName}</p>
            <div class="dashed-line"></div>
            <table class="receipt-table" style="width:100%; font-size:12px;">${itemsHtml}</table>
            <div class="dashed-line"></div>
            <div class="total-row"><span>Total</span><span>৳ ${inv.grandTotal.toFixed(2)}</span></div>
            <div class="dashed-line"></div>
            <p style="font-size:10px;">Thank You!</p>
        </div>
    `;
};

// ===================================
// 4. POS RECEIPT GENERATOR (BANGLA STYLE)
// ===================================
window.viewReceipt = (invId) => {
    const inv = globalInvoices.find(x => x.id === invId);
    if (!inv) return;

    document.getElementById("receiptModal").style.display = "flex";
    const receiptDiv = document.getElementById("receiptContent");

    // তারিখ ও সময় ফরম্যাট (লোকাল)
    let dateStr = inv.date;
    let timeStr = "";
    if (inv.timestamp) {
        const d = new Date(inv.timestamp.toDate());
        // ফরম্যাট: 11/28/2025, 7:18 PM
        dateStr = d.toLocaleDateString('en-US'); 
        timeStr = d.toLocaleTimeString('en-US');
    }

    // আইটেম লুপ
    let itemsRows = "";
    if (inv.cartItems && inv.cartItems.length > 0) {
        inv.cartItems.forEach(item => {
            const itemTotal = (item.price * item.qty).toFixed(2);
            itemsRows += `
                <tr>
                    <td colspan="2" style="font-weight:500;">${item.name} x${item.qty}</td>
                    <td class="text-right">${itemTotal}</td>
                </tr>
            `;
        });
    }

    // হুবহু আপনার স্ক্রিনশটের মতো HTML
    receiptDiv.innerHTML = `
        <div class="receipt-header">
            <h2 style="font-family:sans-serif;">MySolution POS</h2>
            <p>রিসিট</p>
            <p>অর্ডার আইডি: ${inv.id.slice(0, 8)}</p>
            <p>তারিখ: ${dateStr}, ${timeStr}</p>
            <p>স্টোর: ${inv.shopId || inv.shopid || currentShopId}</p>
        </div>
        
        <div class="dashed-line"></div>
        
        <div style="text-align:left; font-size:13px; line-height:1.5;">
            <div><b>কাস্টমার:</b> ${inv.customerName || 'Walk-in'}</div>
            <div><b>ফোন:</b> ${inv.customerPhone || '-'}</div>
        </div>

        <div class="dashed-line"></div>
        <div style="text-align:left; font-weight:bold; font-size:14px; margin-bottom:5px;">আইটেমস:</div>

        <table class="receipt-table">
            <tbody>
                ${itemsRows}
            </tbody>
        </table>

        <div class="dashed-line"></div>

        <div class="total-row">
            <span>সাবটোটাল:</span>
            <span>৳ ${Math.round(inv.subTotal || inv.grandTotal)}</span>
        </div>
        <div class="total-row" style="font-weight:normal;">
            <span>ভ্যাট (0%):</span>
            <span>৳ 0</span>
        </div>
        <div class="total-row">
            <span>মোট বিল:</span>
            <span>৳ ${Math.round(inv.subTotal || inv.grandTotal)}</span>
        </div>
        
        <div class="total-row" style="font-weight:normal;">
            <span>ডিসকাউন্ট:</span>
            <span>- ৳ ${Number(inv.discount).toFixed(2)}</span>
        </div>
        
        <div class="dashed-line"></div>

        <div class="total-row" style="font-size:18px; font-weight:bold;">
            <span>পরিশোধিত:</span>
            <span>৳ ${inv.grandTotal.toFixed(2)}</span>
        </div>

        <div class="dashed-line"></div>

        ${inv.cashReceived > 0 ? `
        <div class="total-row" style="font-weight:normal; margin-top:5px;">
            <span>নগদ:</span>
            <span>৳ ${inv.cashReceived}</span>
        </div>
        <div class="total-row" style="font-weight:normal;">
            <span>ফেরত:</span>
            <span>৳ ${Number(inv.changeAmount).toFixed(2)}</span>
        </div>` : ''}

        <br>
        <p style="font-size:14px;">ধন্যবাদ, আবার আসবেন!</p>
    `;
};
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

loadInventoryStats();
loadSalesReport('today', document.querySelector('.filter-btn.active'));