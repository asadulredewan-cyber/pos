import { initLayout } from "./layout.js";
import { db } from "../../firebase/config.js";
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// 1. Initialize Layout
initLayout("Expense Manager");

// Variables
const currentShopId = localStorage.getItem("active_shop");
let currentUser = JSON.parse(localStorage.getItem("pos_user")) || {};

const modal = document.getElementById("expenseModal");
const tableBody = document.getElementById("expenseTableBody");
const form = document.getElementById("expenseForm");
const totalDisplay = document.getElementById("totalExpenseDisplay");
let allExpenses = [];

// ==========================
// 2. LOAD EXPENSES
// ==========================
// assets/js/expenses.js এর loadExpenses ফাংশন

async function loadExpenses() {
    // Check "All Shops" logic
    if (!currentShopId || currentShopId === "all") {
        document.getElementById("loadingText").innerText = currentShopId === "all"
            ? "খরচ অ্যাড করতে একটি নির্দিষ্ট দোকান সিলেক্ট করুন।"
            : "দোকান সিলেক্ট করা নেই!";

        // বাটন হাইড করা
        if (document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "none";
        return;
    }

    // বাটন শো করা
    if (document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "block";

    const q = query(collection(db, "expenses"), where("shopId", "==", currentShopId));

    try {
        const snapshot = await getDocs(q);
        allExpenses = [];
        let totalAmount = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            allExpenses.push({ id: doc.id, ...data });
            totalAmount += Number(data.amount || 0);
        });

        allExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));

        renderTable(allExpenses);
        if (document.getElementById("totalExpenseDisplay")) {
            document.getElementById("totalExpenseDisplay").innerText = totalAmount.toFixed(2);
        }

        if (allExpenses.length === 0) {
            document.getElementById("loadingText").innerText = "কোনো খরচ পাওয়া যায়নি।";
        } else {
            document.getElementById("loadingText").style.display = "none";
        }

    } catch (error) {
        console.error(error);
        document.getElementById("loadingText").innerText = "ডাটা লোড করতে সমস্যা হয়েছে।";
    }
    filterByMonth();

}

// ==========================
// 3. RENDER TABLE
// ==========================
// assets/js/expenses.js এর renderTable ফাংশন

function renderTable(expenses) {
    tableBody.innerHTML = "";
    expenses.forEach(e => {

        let actionButtons = '';

        // লজিক: শুধুমাত্র Admin বাটন দেখতে পাবে
        if (currentUser.role === 'admin') {
            actionButtons = `
                <button class="btn-action btn-edit" onclick="editExpense('${e.id}')"><i class="fas fa-edit"></i></button>
                <button class="btn-action btn-delete" onclick="deleteExpense('${e.id}')"><i class="fas fa-trash"></i></button>
            `;
        } else {
            // Manager বা অন্যদের জন্য ফাঁকা বা লক আইকন
            actionButtons = `<span style="color:#aaa; font-size:12px;"><i class="fas fa-lock"></i> Restricted</span>`;
        }

        const row = `
            <tr>
                <td>${e.date}</td>
                <td><span class="badge">${e.category}</span></td>
                <td>${e.note || '-'}</td>
                <td class="amount-text">৳ ${e.amount}</td>
                <td><small>${e.addedBy || 'Unknown'}</small></td>
                <td>
                    ${actionButtons}
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

    const id = document.getElementById("editExpenseId").value;
    const data = {
        date: document.getElementById("eDate").value,
        category: document.getElementById("eCategory").value,
        note: document.getElementById("eNote").value.trim(),
        amount: Number(document.getElementById("eAmount").value),
        shopId: currentShopId,
        addedBy: currentUser.name // কে খরচটা অ্যাড করল
    };

    try {
        if (id) {
            await updateDoc(doc(db, "expenses", id), data);
            showToast("✅ খরচ আপডেট হয়েছে", "success");
        } else {
            await addDoc(collection(db, "expenses"), data);
            showToast("🎉 নতুন খরচ যোগ হয়েছে", "success");
        }

        closeExpenseModal();
        loadExpenses();
    } catch (error) {
        console.error(error);
        showToast("❌ সমস্যা হয়েছে, আবার চেষ্টা করুন", "error");
    }
    btn.innerText = "সংরক্ষণ করুন";
});





let selectedYear = new Date().getFullYear();
let selectedMonth = new Date().getMonth(); // 0–11

window.openMonthPicker = function () {
    const monthMap = {};

    allExpenses.forEach(e => {
        if (!e.date) return;

        const d = new Date(e.date);
        if (isNaN(d)) return;

        const key = `${d.getFullYear()}-${d.getMonth()}`;

        if (!monthMap[key]) {
            monthMap[key] = {
                year: d.getFullYear(),
                month: d.getMonth()
            };
        }
    });

    const monthList = document.getElementById("monthList");
    monthList.innerHTML = "";

    const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
    ];

    Object.values(monthMap)
        .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))
        .forEach(m => {
            const div = document.createElement("div");
            div.className = "month-item";
            div.innerText = `${monthNames[m.month]} ${m.year}`;

            div.onclick = () => {
                selectedMonth = m.month;
                selectedYear = m.year;
                filterByMonth();
                closeMonthPicker();
            };

            monthList.appendChild(div);
        });

    document.getElementById("monthPickerModal").style.display = "block";
};

window.closeMonthPicker = function () {
    document.getElementById("monthPickerModal").style.display = "none";
};



function filterByMonth() {
    const filtered = allExpenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    });

    renderTable(filtered);

    const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
    totalDisplay.innerText = total.toFixed(2);
}









// ==========================
// 5. HELPER FUNCTIONS
// ==========================
window.openExpenseModal = () => {
    form.reset();
    document.getElementById("editExpenseId").value = "";

    // Set today's date by default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById("eDate").value = today;

    document.getElementById("modalTitle").innerText = "খরচ যুক্ত করুন";
    modal.style.display = "block";
};

window.closeExpenseModal = () => modal.style.display = "none";

window.editExpense = (id) => {
    const e = allExpenses.find(x => x.id === id);
    if (e) {
        document.getElementById("editExpenseId").value = e.id;
        document.getElementById("eDate").value = e.date;
        document.getElementById("eCategory").value = e.category;
        document.getElementById("eNote").value = e.note;
        document.getElementById("eAmount").value = e.amount;

        document.getElementById("modalTitle").innerText = "খরচ আপডেট করুন";
        modal.style.display = "block";
    }
};


window.deleteExpense = (id) => {
    showConfirmToast("আপনি কি নিশ্চিত এই খরচটি মুছে ফেলতে চান?", async () => {
        try {
            await deleteDoc(doc(db, "expenses", id));
            showToast("🗑️ খরচ ডিলিট হয়েছে", "error");
            loadExpenses();
        } catch (e) {
            showToast("❌ ডিলিট করা যায়নি", "error");
        }
    });
};


// Search Logic
document.getElementById("expenseSearchInput").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();

    const filtered = allExpenses.filter(ex => {
        const d = new Date(ex.date);
        const sameMonth =
            d.getMonth() === selectedMonth &&
            d.getFullYear() === selectedYear;

        const matchText =
            ex.category.toLowerCase().includes(term) ||
            (ex.note && ex.note.toLowerCase().includes(term));

        return sameMonth && matchText;
    });

    renderTable(filtered);

    const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
    totalDisplay.innerText = total.toFixed(2);
});

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

    setTimeout(() => toast.classList.add("show"), 20);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
function showConfirmToast(message, onConfirm) {
    // 🔒 prevent multiple confirms
    if (document.querySelector('.confirm-toast')) return;

    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast confirm-toast";
    toast.innerHTML = `
        <div class="confirm-text">${message}</div>
        <div class="confirm-actions">
            <button class="btn-cancel">Cancel</button>
            <button class="btn-delete">Delete</button>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);

    // 🎯 focus delete for Enter key
    toast.querySelector('.btn-delete').focus();

    const cleanup = () => toast.remove();

    toast.querySelector(".btn-delete").onclick = () => {
        onConfirm();
        cleanup();
    };

    toast.querySelector(".btn-cancel").onclick = cleanup;
}
window.addEventListener("click", (e) => {
    const monthModal = document.getElementById("monthPickerModal");

    // backdrop click
    if (e.target === monthModal) {
        closeMonthPicker();
    }
});


// Start
loadExpenses();