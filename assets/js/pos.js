import { initLayout } from "./layout.js";
import { db } from "../../firebase/config.js";
import { collection, getDocs, addDoc, doc, updateDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 1. Init
initLayout("POS Sale");

const currentShopId = localStorage.getItem("active_shop");
let allProducts = [];
let allCustomers = []; // কাস্টমার ডাটা লোড করে রাখব
let cart = [];

// DOM Elements
const productGrid = document.getElementById("productGrid");
const cartTableBody = document.getElementById("cartTableBody");
const productSearch = document.getElementById("productSearch");
const emptyCartMsg = document.getElementById("emptyCartMsg");

// Payment Modal Elements
const paymentModal = document.getElementById("paymentModal");
const customerSearchInput = document.getElementById("customerSearchInput");
const customerDropdown = document.getElementById("customerDropdown");
const discountPercentInput = document.getElementById("discountPercent");
const cashReceivedInput = document.getElementById("cashReceived");
const changeAmountDisplay = document.getElementById("changeAmount");

// ============================
// 1. CHECK SHOP & LOAD DATA
// ============================
if (!currentShopId || currentShopId === 'all') {
    document.getElementById("posContainer").style.display = "none";
    document.getElementById("shopAlert").style.display = "block";
} else {
    loadProducts();
    loadCustomers(); // কাস্টমার আগেই লোড করে রাখব সার্চের জন্য
}

async function loadProducts() {
    productGrid.innerHTML = '<p style="text-align:center;">Loading products...</p>';
    const q = query(collection(db, "products"), where("shopId", "==", currentShopId));
    try {
        const snap = await getDocs(q);
        allProducts = [];
        snap.forEach(doc => allProducts.push({ id: doc.id, ...doc.data() }));
        productGrid.innerHTML = ""; // শুরুতে ফাঁকা থাকবে
        // যদি সব প্রোডাক্ট দেখাতে চান শুরুতে, তবে এখানে renderProducts(allProducts) কল করুন
        // আপনার রিকোয়ারমেন্ট: শুরুতে কিছু দেখাবে না, সার্চ করলে আসবে।
    } catch (err) { console.error(err); }
}

async function loadCustomers() {
    const q = query(collection(db, "customers"), where("shopId", "==", currentShopId));
    const snap = await getDocs(q);
    allCustomers = [];
    snap.forEach(doc => allCustomers.push({ id: doc.id, ...doc.data() }));
}

// ============================
// 2. SEARCH & BARCODE LOGIC
// ============================
productSearch.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();
    
    if (term.length === 0) {
        productGrid.innerHTML = ""; // ক্লিয়ার
        return;
    }

    // Filter Logic
    const filtered = allProducts.filter(p => 
        p.name.toLowerCase().includes(term) || 
        (p.barcode && p.barcode.toLowerCase() === term) // Exact barcode match for scan
    );

    // Barcode Auto Add Logic
    // যদি ১টি প্রোডাক্ট পাই এবং সেটা বারকোড বা হুবহু নামের সাথে মিলে যায়
    const exactMatch = allProducts.find(p => p.barcode && p.barcode.toLowerCase() === term);
    
    // স্ক্যানার সাধারণত খুব দ্রুত টাইপ করে, তাই এখানে লজিক হলো:
    // যদি ১টা রেজাল্ট আসে এবং সেটা স্ক্যান (এন্টার চাপলে সাধারণত স্ক্যানার ইনপুট দেয়)
    
    renderProducts(filtered.slice(0, 5)); // সর্বোচ্চ ৫টা দেখাবো
});

// Barcode Scanner 'Enter' Detection
productSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        const term = productSearch.value.toLowerCase().trim();
        const exactMatch = allProducts.filter(p => p.barcode && p.barcode.toLowerCase() === term);

        if (exactMatch.length === 1) {
            addToCart(exactMatch[0]);
            productSearch.value = ""; // Clear input after scan
            productSearch.focus();
            productGrid.innerHTML = ""; // Grid clear
        } else if (exactMatch.length > 1) {
            // ২ বা ততোধিক প্রোডাক্ট থাকলে পপআপ বা গ্রিডে দেখাবে
            renderProducts(exactMatch);
        }
    }
});

function renderProducts(products) {
    productGrid.innerHTML = "";
    if (products.length === 0) return;

    products.forEach(p => {
        const img = p.image || "https://placehold.co/50";
        const div = document.createElement("div");
        div.className = "product-card";
        div.innerHTML = `
            <img src="${img}" class="p-img">
            <div class="p-name">${p.name}</div>
            <div class="p-price">৳ ${p.sellPrice}</div>
            <small style="color:${p.stock < 5 ? 'red' : 'green'}">Stock: ${p.stock}</small>
        `;
        div.onclick = () => addToCart(p);
        productGrid.appendChild(div);
    });
}

// ============================
// 3. CART LOGIC
// ============================
window.addToCart = (product) => {
    // Check Stock locally
    const existing = cart.find(x => x.id === product.id);
    const currentQty = existing ? existing.qty : 0;
    
    if (currentQty + 1 > product.stock) {
        alert("স্টক শেষ!");
        return;
    }

    if (existing) {
        existing.qty++;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: Number(product.sellPrice),
            buyPrice: Number(product.buyPrice), // লাভের হিসাবের জন্য
            qty: 1
        });
    }
    updateCartUI();
};

function updateCartUI() {
    cartTableBody.innerHTML = "";
    let total = 0;

    cart.forEach((item, index) => {
        const lineTotal = item.price * item.qty;
        total += lineTotal;
        cartTableBody.innerHTML += `
            <tr>
                <td>${item.name}</td>
                <td>${item.price}</td>
                <td>
                    <button onclick="changeQty(${index}, -1)">-</button>
                    ${item.qty}
                    <button onclick="changeQty(${index}, 1)">+</button>
                </td>
                <td>${lineTotal}</td>
                <td><i class="fas fa-trash" style="color:red; cursor:pointer;" onclick="removeItem(${index})"></i></td>
            </tr>
        `;
    });

    document.getElementById("subTotalDisplay").innerText = total.toFixed(2);
    document.getElementById("grandTotalDisplay").innerText = total.toFixed(2); // Initially same
    
    if(cart.length === 0) emptyCartMsg.style.display = 'block';
    else emptyCartMsg.style.display = 'none';
}

window.changeQty = (index, change) => {
    const item = cart[index];
    const product = allProducts.find(p => p.id === item.id);
    
    if (item.qty + change > product.stock) {
        alert("স্টক লিমিট অতিক্রান্ত!");
        return;
    }
    if (item.qty + change > 0) {
        item.qty += change;
        updateCartUI();
    }
};

window.removeItem = (index) => {
    cart.splice(index, 1);
    updateCartUI();
};

window.clearCart = () => {
    if(confirm("কার্ট ক্লিয়ার করবেন?")) {
        cart = [];
        updateCartUI();
    }
};

// ============================
// 4. PAYMENT MODAL LOGIC
// ============================
window.openPaymentModal = () => {
    if (cart.length === 0) {
        alert("কার্ট খালি!");
        return;
    }
    
    // Reset Modal Fields
    customerSearchInput.value = "";
    document.getElementById("customerPhone").value = "";
    document.getElementById("selectedCustomerId").value = "";
    discountPercentInput.value = 0;
    cashReceivedInput.value = "";
    document.getElementById("changeAmount").value = "";
    
    // Calculate & Show Initial Total
    calculatePaymentMath();
    
    paymentModal.style.display = "flex";
    customerSearchInput.focus();
};

window.closePaymentModal = () => paymentModal.style.display = "none";

// --- Customer Search & Discount Logic ---
window.filterCustomers = () => {
    const term = customerSearchInput.value.toLowerCase();
    customerDropdown.innerHTML = "";
    
    if(term.length === 0) {
        customerDropdown.style.display = "none";
        return;
    }

    const filtered = allCustomers.filter(c => 
        c.name.toLowerCase().includes(term) || c.phone.includes(term)
    );

    if (filtered.length > 0) {
        customerDropdown.style.display = "block";
        filtered.forEach(c => {
            const div = document.createElement("div");
            div.className = "dropdown-item";
            div.innerHTML = `<b>${c.name}</b> (${c.phone}) - <small>${c.type || 'Regular'}</small>`;
            div.onclick = () => selectCustomer(c);
            customerDropdown.appendChild(div);
        });
    } else {
        customerDropdown.style.display = "none";
    }
};

function selectCustomer(c) {
    customerSearchInput.value = c.name;
    document.getElementById("customerPhone").value = c.phone;
    document.getElementById("selectedCustomerId").value = c.id;
    customerDropdown.style.display = "none";

    // Auto Discount Logic
    let disc = 0;
    if (c.type === 'Premium') disc = 5;
    else if (c.type === 'Wholesale') disc = 10;
    else disc = 0; // Regular

    discountPercentInput.value = disc;
    calculatePaymentMath(); // Re-calculate with discount
}

// Auto Search by Phone (Min 8 digits)
document.getElementById("customerPhone").addEventListener("input", (e) => {
    const num = e.target.value;
    if (num.length >= 8) {
        const found = allCustomers.find(c => c.phone === num);
        if (found) selectCustomer(found);
    }
});

// Math Calculation
window.calculatePaymentMath = () => {
    const subTotal = parseFloat(document.getElementById("subTotalDisplay").innerText);
    const discPercent = parseFloat(discountPercentInput.value) || 0;
    
    const discountAmount = (subTotal * discPercent) / 100;
    const payable = subTotal - discountAmount;
    
    document.getElementById("modalPayableAmount").innerText = subTotal.toFixed(2); // Original Bill
    document.getElementById("finalPayable").innerText = payable.toFixed(2); // After Discount

    const cash = parseFloat(cashReceivedInput.value) || 0;
    const change = cash - payable;
    
    document.getElementById("changeAmount").value = change >= 0 ? change.toFixed(2) : "0.00";
};

// Event Listeners for Math
discountPercentInput.addEventListener("input", calculatePaymentMath);
cashReceivedInput.addEventListener("input", calculatePaymentMath);

// ============================
// 5. PROCESS SALE (SAVE TO DB)
// ============================
window.processSale = async () => {
    const customerName = customerSearchInput.value;
    if (!customerName) {
        alert("কাস্টমারের নাম দিন!");
        return;
    }

    const confirmBtn = document.querySelector(".btn-confirm");
    confirmBtn.innerText = "Processing...";
    confirmBtn.disabled = true;

    // Calculation
    const subTotal = parseFloat(document.getElementById("subTotalDisplay").innerText);
    const discount = parseFloat(discountPercentInput.value) || 0;
    const discountAmount = (subTotal * discount) / 100;
    const grandTotal = subTotal - discountAmount;
    const cash = parseFloat(cashReceivedInput.value) || 0;
    const change = parseFloat(document.getElementById("changeAmount").value);

    // Calculate Total Profit
    let totalProfit = 0;
    cart.forEach(item => {
        const profitPerItem = item.price - item.buyPrice;
        totalProfit += (profitPerItem * item.qty);
    });
    // Subtract discount from profit
    totalProfit -= discountAmount;

    // Invoice Object
    const invoiceData = {
        shopId: currentShopId,
        customerName: customerName,
        customerPhone: document.getElementById("customerPhone").value,
        cartItems: cart,
        subTotal: subTotal,
        discount: discountAmount, // saving amount, not percent
        grandTotal: grandTotal,
        cashReceived: cash,
        changeAmount: change,
        totalProfit: totalProfit,
        date: new Date().toISOString().split('T')[0],
        timestamp: serverTimestamp()
    };

    try {
        // 1. Save Invoice
        const docRef = await addDoc(collection(db, "invoices"), invoiceData);
        const invoiceId = docRef.id;

        // 2. Update Stock (Loop)
        for (const item of cart) {
            const productRef = doc(db, "products", item.id);
            const productInList = allProducts.find(p => p.id === item.id);
            const newStock = productInList.stock - item.qty;
            
            await updateDoc(productRef, { stock: newStock });
        }

        // 3. Success -> Show Receipt
        closePaymentModal();
        showReceiptModal(invoiceData, invoiceId);
        
        // Reset
        cart = [];
        updateCartUI();
        loadProducts(); // Reload to get fresh stock

    } catch (error) {
        console.error(error);
        alert("Sale Failed: " + error.message);
    }
    confirmBtn.innerText = "কনফার্ম";
    confirmBtn.disabled = false;
};

// ============================
// 6. SHOW RECEIPT (FINAL)
// ============================
function showReceiptModal(data, id) {
    const modal = document.getElementById("receiptModal");
    const content = document.getElementById("receiptContent");
    
    // Items HTML
    let itemsHtml = data.cartItems.map(item => `
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:5px;">
            <span>${item.name} x${item.qty}</span>
            <span>${(item.price * item.qty).toFixed(2)}</span>
        </div>
    `).join("");

    content.innerHTML = `
        <div style="text-align:center; font-family:'Courier New', monospace; color:black;">
            <h2 style="margin:0;">MySolution POS</h2>
            <p style="margin:2px;">রিসিট</p>
            <p style="font-size:11px;">অর্ডার আইডি: ${id.slice(0, 8)}</p>
            <p style="font-size:11px;">তারিখ: ${new Date().toLocaleString()}</p>
            <p style="font-size:11px;">স্টোর: ${currentShopId}</p>
            <hr style="border-top:1px dashed #000;">
            <div style="text-align:left; font-size:12px;">
                <p><strong>কাস্টমার:</strong> ${data.customerName}</p>
                <p><strong>ফোন:</strong> ${data.customerPhone}</p>
            </div>
            <hr style="border-top:1px dashed #000;">
            <div style="text-align:left;"><b>আইটেমস:</b></div>
            ${itemsHtml}
            <hr style="border-top:1px dashed #000;">
            
            <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>সাবটোটাল:</span> <span>৳ ${data.subTotal}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>ভ্যাট (0%):</span> <span>৳ 0</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>মোট বিল:</span> <span>৳ ${data.subTotal}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>ডিসকাউন্ট:</span> <span>- ৳ ${data.discount.toFixed(2)}</span>
            </div>
            <hr style="border-top:1px dashed #000;">
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:15px;">
                <span>পরিশোধিত:</span> <span>৳ ${data.grandTotal.toFixed(2)}</span>
            </div>
            <hr style="border-top:1px dashed #000;">
            <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>নগদ:</span> <span>৳ ${data.cashReceived}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>ফেরত:</span> <span>৳ ${data.changeAmount.toFixed(2)}</span>
            </div>
            <br>
            <p>ধন্যবাদ, আবার আসবেন!</p>
        </div>
    `;
    
    modal.style.display = "block";
}

window.closeReceiptModal = () => document.getElementById("receiptModal").style.display = "none";

window.printReceipt = () => {
    const content = document.getElementById("receiptContent").innerHTML;
    const win = window.open('', '', 'height=600,width=400');
    win.document.write('<html><head><title>Receipt</title></head><body style="text-align:center;">');
    win.document.write(content);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
};

// Keyboard Shortcut F3
document.addEventListener("keydown", (e) => {
    if(e.key === "F3") {
        e.preventDefault();
        openPaymentModal();
    }
});