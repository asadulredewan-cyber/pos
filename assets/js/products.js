import { initLayout } from "./layout.js";
import { db } from "../../firebase/config.js";
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 1. Initialize Layout
initLayout("Product List");

// Global Variables
let currentUser = JSON.parse(localStorage.getItem("pos_user")) || {};
const currentShopId = localStorage.getItem("active_shop");

const modal = document.getElementById("productModal");
const tableBody = document.getElementById("productTableBody");
const form = document.getElementById("productForm");
const btnAddProduct = document.getElementById("btnAddProduct");
let allProducts = [];

// ==========================
// 🔥 কাস্টম নোটিফিকেশন ফাংশন (সবার ওপরে রাখা হলো যাতে সবাই পায়)
// ==========================
function showToast(message, type = "success") {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "fa-check-circle" : "fa-exclamation-circle";
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 100);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==========================
// 2. CHECK PERMISSION & LOAD
// ==========================
if (currentUser.role === "seller") {
    if(btnAddProduct) btnAddProduct.style.display = "none";
}

async function loadProducts() {
    if (!currentShopId) {
        document.getElementById("loadingText").innerText = "দোকান সিলেক্ট করা নেই!";
        return;
    }

    if (currentShopId === "all") {
        document.getElementById("loadingText").innerText = "অনুগ্রহ করে একটি নির্দিষ্ট দোকান সিলেক্ট করুন ডাটা দেখার জন্য।";
        if(document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "none";
        return;
    }

    if(currentUser.role !== 'seller' && document.querySelector(".btn-add")) {
        document.querySelector(".btn-add").style.display = "block";
    }

    const q = query(collection(db, "products"), where("shopId", "==", currentShopId));

    try {
        const snapshot = await getDocs(q);
        allProducts = [];
        snapshot.forEach(doc => {
            allProducts.push({ id: doc.id, ...doc.data() });
        });
        
        renderTable(allProducts);
        
        if (allProducts.length === 0) {
            document.getElementById("loadingText").innerText = "কোনো পণ্য পাওয়া যায়নি।";
            document.getElementById("loadingText").style.display = "block";
        } else {
            document.getElementById("loadingText").style.display = "none";
        }

    } catch (error) {
        console.error(error);
        document.getElementById("loadingText").innerText = "ডাটা লোড করতে সমস্যা হয়েছে।";
    }
}

// ==========================
// 3. RENDER TABLE
// ==========================
function renderTable(products) {
    tableBody.innerHTML = "";
    products.forEach(p => {
        const img = p.image || "https://placehold.co/40";
        const unit = p.unit || "pcs";
        const barcode = p.barcode ? `<br><small style="color:#666; font-size:11px;"><i class="fas fa-barcode"></i> ${p.barcode}</small>` : "";
        
        const lowStockLimit = p.lowAlert || 5;
        const stockStyle = p.stock <= lowStockLimit ? "color:red; font-weight:bold;" : "color:green;";

        let actionButtons = `
            <button class="btn-action btn-edit" onclick="window.editProduct('${p.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn-action btn-delete" onclick="window.deleteProduct('${p.id}')"><i class="fas fa-trash"></i></button>
        `;
        
        if(currentUser.role === 'seller') actionButtons = '<span style="color:#aaa; font-size:12px;">No Access</span>';

        const row = `
            <tr>
                <td><img src="${img}" class="table-img"></td>
                <td>${p.name}${barcode}</td>
                <td>${p.category}</td>
                <td>${p.buyPrice}</td>
                <td>${p.sellPrice}</td>
                <td style="${stockStyle}">${p.stock} <span style="font-size:11px; color:#555;">${unit}</span></td>
                <td>${actionButtons}</td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}

// ==========================
// 4. ADD / EDIT LOGIC
// ==========================
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.querySelector(".btn-save");
    const originalText = btn.innerText;
    btn.innerText = "Saving...";

    const id = document.getElementById("editProductId").value;
    
    const data = {
        name: document.getElementById("pName").value.trim(),
        barcode: document.getElementById("pBarcode").value.trim(),
        category: document.getElementById("pCategory").value,
        unit: document.getElementById("pUnit").value,
        stock: Number(document.getElementById("pStock").value),
        lowAlert: Number(document.getElementById("pLowAlert").value),
        buyPrice: Number(document.getElementById("pCost").value),
        sellPrice: Number(document.getElementById("pPrice").value),
        image: document.getElementById("pImage").value.trim(),
        shopId: currentShopId
    };

    try {
        if (id) {
            await updateDoc(doc(db, "products", id), data);
            showToast("✅ পণ্য সফলভাবে আপডেট করা হয়েছে!");
        } else {
            await addDoc(collection(db, "products"), data);
            showToast("🚀 নতুন পণ্য যোগ করা হয়েছে!");
        }
        
        // মোডাল সরাসরি বন্ধ করা হচ্ছে আইডি দিয়ে (এরর এড়াতে)
        const productModal = document.getElementById("productModal");
        if (productModal) productModal.style.display = "none";
        
        loadProducts();
    } catch (error) {
        console.error(error);
        showToast("❌ সমস্যা হয়েছে: " + error.message, "error");
    }
    btn.innerText = originalText;
});

// ==========================
// 5. HELPER FUNCTIONS (Window Global)
// ==========================
window.openProductModal = () => {
    form.reset();
    document.getElementById("editProductId").value = "";
    document.getElementById("pUnit").value = "pcs";
    document.getElementById("pLowAlert").value = "5";
    document.getElementById("modalTitle").innerText = "নতুন পণ্য যোগ করুন";
    modal.style.display = "block";
};

window.closeProductModal = () => modal.style.display = "none";

window.editProduct = (id) => {
    const p = allProducts.find(x => x.id === id);
    if (p) {
        document.getElementById("editProductId").value = p.id;
        document.getElementById("pName").value = p.name;
        document.getElementById("pBarcode").value = p.barcode || "";
        document.getElementById("pCategory").value = p.category;
        document.getElementById("pUnit").value = p.unit || "pcs";
        document.getElementById("pStock").value = p.stock;
        document.getElementById("pLowAlert").value = p.lowAlert || 5;
        document.getElementById("pCost").value = p.buyPrice;
        document.getElementById("pPrice").value = p.sellPrice;
        document.getElementById("pImage").value = p.image || "";
        
        document.getElementById("modalTitle").innerText = "পণ্য আপডেট করুন";
        modal.style.display = "block";
    }
};

window.deleteProduct = async (id) => {
    if (currentUser.role === 'seller') {
        showToast("⚠️ সেলার পণ্য ডিলিট করতে পারবে না!", "error");
        return;
    }

    // Custom confirm toast
    showConfirmToast(
        "আপনি কি নিশ্চিত এই পণ্যটি ডিলিট করতে চান?",
        async () => {
            try {
                await deleteDoc(doc(db, "products", id));
                showToast("🗑️ পণ্যটি সফলভাবে ডিলিট করা হয়েছে।", "success");
                loadProducts();
            } catch (error) {
                console.error(error);
                showToast("❌ ডিলিট করা যায়নি!", "error");
            }
        }
    );
};
function showConfirmToast(message, onConfirm) {
    if (document.querySelector('.confirm-toast')) return;
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast confirm-toast show";
    toast.tabIndex = -1; // keyboard focus

    toast.innerHTML = `
        <div class="confirm-text">${message}</div>
        <div class="confirm-actions">
            <button class="btn-cancel">Cancel</button>
            <button class="btn-delete">Delete</button>
        </div>
    `;

    container.appendChild(toast);
    toast.focus();

    // Button events
    toast.querySelector(".btn-delete").onclick = () => {
        onConfirm();
        toast.remove();
        document.removeEventListener("keydown", keyHandler);
    };

    toast.querySelector(".btn-cancel").onclick = () => {
        toast.remove();
        document.removeEventListener("keydown", keyHandler);
    };

    // Keyboard support
    function keyHandler(e) {
        if (e.key === "Enter") {
            onConfirm();
            toast.remove();
            document.removeEventListener("keydown", keyHandler);
        }
        if (e.key === "Escape") {
            toast.remove();
            document.removeEventListener("keydown", keyHandler);
        }
    }

    document.addEventListener("keydown", keyHandler);
}



// Search (Name or Barcode)
document.getElementById("productSearchInput").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allProducts.filter(p => 
        p.name.toLowerCase().includes(term) || 
        (p.barcode && p.barcode.toLowerCase().includes(term))
    );
    renderTable(filtered);
});

// 🚀 Start Application
loadProducts();