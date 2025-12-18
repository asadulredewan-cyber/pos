import { initLayout } from "./layout.js";
import { db } from "../../firebase/config.js";
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 1. Initialize Layout
initLayout("Customer List");

// Variables
const currentShopId = localStorage.getItem("active_shop");
let currentUser = JSON.parse(localStorage.getItem("pos_user")) || {};

const modal = document.getElementById("customerModal");
const tableBody = document.getElementById("customerTableBody");
const form = document.getElementById("customerForm");
let allCustomers = [];

// ==========================
// 2. LOAD CUSTOMERS
// ==========================
// assets/js/customers.js এর loadCustomers ফাংশন

async function loadCustomers() {
    // Check "All Shops" logic
    if (!currentShopId || currentShopId === "all") {
        document.getElementById("loadingText").innerText = currentShopId === "all" 
            ? "কাস্টমার অ্যাড করতে একটি নির্দিষ্ট দোকান সিলেক্ট করুন।" 
            : "দোকান সিলেক্ট করা নেই!";
            
        // বাটন হাইড করা
        if(document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "none";
        return;
    }

    // বাটন শো করা (যদি লুকানো থাকে)
    if(document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "block";

    const q = query(collection(db, "customers"), where("shopId", "==", currentShopId));

    try {
        const snapshot = await getDocs(q);
        allCustomers = [];
        snapshot.forEach(doc => {
            allCustomers.push({ id: doc.id, ...doc.data() });
        });
        
        renderTable(allCustomers);
        
        if (allCustomers.length === 0) {
            document.getElementById("loadingText").innerText = "কোনো কাস্টমার পাওয়া যায়নি।";
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




// ==========================
// 3. RENDER TABLE (FIXED)
// ==========================
function renderTable(customers) {
    tableBody.innerHTML = "";
    customers.forEach(c => {
        
        // সেলার হলে ডিলিট বাটন দেখাবে না
        let deleteBtn = `<button class="btn-action btn-delete" onclick="deleteCustomer('${c.id}')"><i class="fas fa-trash"></i></button>`;
        if (currentUser.role === 'seller') {
            deleteBtn = ''; 
        }

        const row = `
            <tr>
                <td>
                    <b>${c.name}</b><br>
                    <small style="color:#00a6ff; font-weight:bold;">${c.type || 'Regular'}</small>
                </td>
                
                <td>${c.phone}</td>
                
                <td>${c.email || '-'}</td>
                
                <td>${c.address || '-'}</td>
                
                <td>
                    <button class="btn-action btn-edit" onclick="editCustomer('${c.id}')"><i class="fas fa-edit"></i></button>
                    ${deleteBtn}
                </td>
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
    btn.innerText = "Saving...";

    const id = document.getElementById("editCustomerId").value;
    const data = {
        name: document.getElementById("cName").value.trim(),
        phone: document.getElementById("cPhone").value.trim(),
        email: document.getElementById("cEmail").value.trim(),
        address: document.getElementById("cAddress").value.trim(),
        type: document.getElementById("cType").value, // 🔥 নতুন লাইন
        shopId: currentShopId
    };

    try {
        if (id) {
    await updateDoc(doc(db, "customers", id), data);
    showToast("✅ কাস্টমার তথ্য আপডেট হয়েছে");
} else {
    await addDoc(collection(db, "customers"), data);
    showToast("🎉 নতুন কাস্টমার যোগ হয়েছে");
}

        closeCustomerModal();
        loadCustomers();
    } catch (error) {
         console.error(error);
    showToast("❌ সমস্যা হয়েছে, আবার চেষ্টা করুন", "error");
    }
    btn.innerText = "সংরক্ষণ করুন";
});

// ==========================
// 5. HELPER FUNCTIONS
// ==========================
window.openCustomerModal = () => {
    form.reset();
    document.getElementById("editCustomerId").value = "";
    document.getElementById("cType").value = "Regular"; // ডিফল্ট সেট
    document.getElementById("modalTitle").innerText = "নতুন কাস্টমার";
    modal.style.display = "block";
};
window.closeCustomerModal = () => modal.style.display = "none";

window.editCustomer = (id) => {
    const c = allCustomers.find(x => x.id === id);
    if (c) {
        document.getElementById("editCustomerId").value = c.id;
        document.getElementById("cName").value = c.name;
        document.getElementById("cPhone").value = c.phone;
        document.getElementById("cEmail").value = c.email || "";
        document.getElementById("cAddress").value = c.address || "";
        document.getElementById("cType").value = c.type || "Regular";

        document.getElementById("modalTitle").innerText = "তথ্য আপডেট করুন";
        modal.style.display = "block";
    }
};

window.deleteCustomer = (id) => {
    if (currentUser.role === "seller") return;

    showConfirmToast("আপনি কি নিশ্চিত এই কাস্টমারকে ডিলিট করতে চান?", async () => {
        try {
           await deleteDoc(doc(db, "customers", id));
showToast("🗑️ কাস্টমার ডিলিট হয়েছে");
loadCustomers();

        } catch (error) {
            console.error(error);
        }
    });
};

// Search Logic
document.getElementById("customerSearchInput").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allCustomers.filter(c => 
        c.name.toLowerCase().includes(term) || 
        c.phone.includes(term)
    );
    renderTable(filtered);
});
function showConfirmToast(message, onConfirm) {
    if (document.querySelector('.confirm-toast')) return;
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast confirm-toast";
    toast.tabIndex = -1;

    toast.innerHTML = `
        <div class="confirm-text">${message}</div>
        <div class="confirm-actions">
            <button class="btn-cancel">Cancel</button>
            <button class="btn-delete">Delete</button>
        </div>
    `;

    container.appendChild(toast);
    toast.focus();

    const cleanup = () => {
        toast.remove();
        document.removeEventListener("keydown", keyHandler);
    };

    toast.querySelector(".btn-delete").onclick = () => {
        onConfirm();
        cleanup();
    };

    toast.querySelector(".btn-cancel").onclick = cleanup;

    function keyHandler(e) {
        if (e.key === "Enter") {
            onConfirm();
            cleanup();
        }
        if (e.key === "Escape") {
            cleanup();
        }
    }

    document.addEventListener("keydown", keyHandler);
}
function showToast(message, type = "success") {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;

    container.appendChild(toast);

    // animate
    setTimeout(() => toast.classList.add("show"), 50);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Start
loadCustomers();