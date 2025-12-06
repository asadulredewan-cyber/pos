import { auth, db } from "../../firebase/config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

export function initLayout(pageTitle) {
    const appContainer = document.getElementById("app-layout");
    
    // Inject Layout HTML
    appContainer.innerHTML = `
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">
                <h2>PRO POS</h2>
                <button id="closeSidebar" class="close-sidebar-btn">&times;</button> 
                
                <div class="shop-profile-box">
                    <p class="shop-label">বর্তমান দোকান</p>
                    <div id="shopSelectorContainer">Loading...</div>
                </div>
            </div>

            <ul class="menu">
                <li id="menu-dashboard"><a href="dashboard.html"><i class="fas fa-home"></i> Dashboard</a></li>
                <li id="menu-pos"><a href="pos.html"><i class="fas fa-cash-register"></i> POS Sale (F2)</a></li>
                <li id="menu-products"><a href="products.html"><i class="fas fa-box"></i> Products</a></li>
                <li id="menu-customers"><a href="customers.html"><i class="fas fa-users"></i> Customers</a></li>
                <li id="menu-expenses"><a href="expenses.html"><i class="fas fa-wallet"></i> Expense</a></li>
                <li id="menu-reports"><a href="reports.html"><i class="fas fa-chart-line"></i> Reports</a></li>
            </ul>

            <div class="user-profile-side">
                <button id="logoutBtn" class="logout-btn">Logout</button>
            </div>
        </aside>

        <div id="sidebarOverlay" class="sidebar-overlay"></div>

        <div class="main-wrapper">
            <header class="top-bar">
                <div style="display:flex; align-items:center; gap:15px;">
                    <button id="mobileMenuBtn" class="mobile-menu-btn">
                        <i class="fas fa-bars"></i>
                    </button>
                    <h2 class="page-title">${pageTitle}</h2>
                </div>

                <div class="top-user-info">
                    <span class="user-name" id="topUserName">...</span>
                    <span class="role-badge" id="topUserRole">...</span>
                </div>
            </header>

            <div class="content-body" id="injected-content"></div>
        </div>
    `;

    // Inject Page Content
    const existingContent = document.getElementById("main-content-body");
    if(existingContent) {
        document.getElementById("injected-content").appendChild(existingContent);
        existingContent.style.display = "block";
    }

    // 🔥 1. ACTIVE MENU HIGHLIGHT LOGIC (NEW ADDED)
    const currentPage = window.location.pathname.split("/").pop().replace(".html", "") || "dashboard";
    // বিশেষ চেক: index.html বা খালি থাকলে dashboard ধরবে
    const activeId = `menu-${currentPage === 'index' || currentPage === '' ? 'dashboard' : currentPage}`;
    const activeItem = document.getElementById(activeId);
    if(activeItem) activeItem.classList.add("active");


    // 🔥 MOBILE MENU LOGIC
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const openBtn = document.getElementById("mobileMenuBtn");
    const closeBtn = document.getElementById("closeSidebar");

    openBtn.addEventListener("click", () => {
        sidebar.classList.add("active");
        overlay.classList.add("active");
    });

    function closeMenu() {
        sidebar.classList.remove("active");
        overlay.classList.remove("active");
    }

    closeBtn.addEventListener("click", closeMenu);
    overlay.addEventListener("click", closeMenu);

    // Auth Check
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "index.html";
            return;
        }
        await loadUserData(user.uid);
    });

    // Logout
    document.getElementById("logoutBtn").addEventListener("click", () => {
        signOut(auth).then(() => {
            localStorage.removeItem("pos_user");
            localStorage.removeItem("active_shop"); // শপ ক্লিয়ার করা ভালো
            window.location.href = "index.html";
        });
    });

    // Shortcuts
    setupGlobalShortcuts();
}

async function loadUserData(uid) {
    let userData = JSON.parse(localStorage.getItem("pos_user"));
    
    if (!userData) {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (docSnap.exists()) {
            userData = docSnap.data();
            localStorage.setItem("pos_user", JSON.stringify(userData));
        }
    }

    if (userData) {
        document.getElementById("topUserName").innerText = userData.name;
        document.getElementById("topUserRole").innerText = userData.role;
        renderShopSelector(userData);
    }
}

function renderShopSelector(user) {
    const container = document.getElementById("shopSelectorContainer");
    const role = user.role;
    const shops = user.shops || [];
    
    if ((role === "admin" || role === "manager") && shops.length > 1) {
        let optionsHtml = '';
        if (role === 'admin') {
            optionsHtml += `<option value="all">All Shops</option>`;
        }
        shops.forEach(shop => {
            optionsHtml += `<option value="${shop}">${shop}</option>`;
        });

        container.innerHTML = `<select id="globalShopSelector" class="sidebar-select">${optionsHtml}</select>`;

        const savedShop = localStorage.getItem("active_shop");
        const selector = document.getElementById("globalShopSelector");
        
        // সেভ করা শপ লিস্টে থাকলে সিলেক্ট করবে
        if (savedShop && (savedShop === 'all' || shops.includes(savedShop))) {
            selector.value = savedShop;
        }

        // Change Event -> Auto Refresh
        selector.addEventListener("change", (e) => {
            localStorage.setItem("active_shop", e.target.value);
            window.location.reload(); 
        });

    } else {
        // 🔥 2. SELLER SHOP ID SAFETY (NEW ADDED)
        const myShop = (role === "seller") ? (user.shopId || user.shopid) : shops[0];
        
        container.innerHTML = `<h3 class="shop-name-display">${myShop}</h3>`;
        
        const currentActive = localStorage.getItem("active_shop");
        if(!currentActive || currentActive === 'all') {
            localStorage.setItem("active_shop", myShop);
            if(currentActive === 'all') window.location.reload();
        }
    }
}

function setupGlobalShortcuts() {
    document.addEventListener("keydown", (e) => {
        if (e.key === "F1") { e.preventDefault(); window.location.href = "dashboard.html"; }
        if (e.key === "F2") { 
            e.preventDefault(); 
            // POS পেজে থাকলে রিলোড করার দরকার নেই, পেমেন্ট ওপেন হবে (সেটা pos.js হ্যান্ডেল করবে)
            if(!window.location.pathname.includes("pos.html")) {
                window.location.href = "pos.html";
            }
        }
        if (e.key === "F4") { e.preventDefault(); window.location.href = "products.html"; }
        if (e.key === "F5") { e.preventDefault(); window.location.href = "customers.html"; }
    });
}