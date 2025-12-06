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
        if(document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "none";
        return;
    }

    // বাটন শো করা
    if(document.querySelector(".btn-add")) document.querySelector(".btn-add").style.display = "block";

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
        if(document.getElementById("totalExpenseDisplay")) {
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
            alert("খরচ আপডেট হয়েছে!");
        } else {
            await addDoc(collection(db, "expenses"), data);
            alert("নতুন খরচ যোগ হয়েছে!");
        }
        closeExpenseModal();
        loadExpenses();
    } catch (error) {
        console.error(error);
        alert("সমস্যা হয়েছে: " + error.message);
    }
    btn.innerText = "সংরক্ষণ করুন";
});

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

window.deleteExpense = async (id) => {
    if (confirm("আপনি কি নিশ্চিত এই খরচটি মুছে ফেলতে চান?")) {
        try {
            await deleteDoc(doc(db, "expenses", id));
            loadExpenses();
        } catch (error) {
            alert("মুছে ফেলা যায়নি!");
        }
    }
};

// Search Logic
document.getElementById("expenseSearchInput").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allExpenses.filter(ex => 
        ex.category.toLowerCase().includes(term) || 
        (ex.note && ex.note.toLowerCase().includes(term))
    );
    renderTable(filtered);
});

// Start
loadExpenses();