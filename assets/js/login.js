import { auth, db } from "../../firebase/config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// DOM Elements
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const statusBox = document.getElementById("status");

// Autofill Clear Fix
window.addEventListener('load', () => {
    emailInput.value = "";
    passwordInput.value = "";

    setTimeout(() => {
        emailInput.value = "";
        passwordInput.value = "";
    }, 50);
});

function showStatus(text, isError = false) {
    statusBox.innerText = text;
    statusBox.style.color = isError ? "red" : "green";
}

async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        showStatus("Email & Password দিন", true);
        return;
    }

    showStatus("Logging in...");

    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        const user = result.user;

        // Load Firestore user doc
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
            showStatus("User profile পাওয়া যায়নি", true);
            return;
        }

        const data = snap.data();
        const role = data.role;
        const userShopId = data.shopId || data.shopid;
        const shops = data.shops || [];

        // Save full profile
        localStorage.setItem("pos_user", JSON.stringify(data));

        // Redirect based on role
        if (role === "seller") {
            if (userShopId) localStorage.setItem("active_shop", userShopId);
            window.location.href = "dashboard.html";
        }
        else if (role === "manager") {
            const defaultShop = shops.length > 0 ? shops[0] : userShopId;
            if (defaultShop) localStorage.setItem("active_shop", defaultShop);
            window.location.href = "dashboard.html";
        }
        else if (role === "admin") {
            // admin will only access own shops, so set 'all'
            localStorage.setItem("active_shop", "all");
            window.location.href = "dashboard.html";
        }
        else {
            showStatus("Unknown role!", true);
        }

    } catch (error) {
        let message = "";

        switch (error.code) {
            case "auth/invalid-login-credentials":
                message = "❌ Email বা Password ভুল দিয়েছেন!";
                break;

            case "auth/wrong-password":
                message = "❌ Password ভুল দিয়েছেন!";
                break;

            case "auth/user-not-found":
                message = "❌ এই ইমেইলটি রেজিস্টার করা নেই!";
                break;

            case "auth/invalid-email":
                message = "⚠ সঠিক ইমেইল দিন!";
                break;

            case "auth/network-request-failed":
                message = "📡 ইন্টারনেট কানেকশন নেই!";
                break;

            case "auth/too-many-requests":
                message = "⛔ অনেকবার ভুল দিয়েছেন! কিছুক্ষণ পরে চেষ্টা করুন।";
                break;

            default:
                message = "⚠ Error: " + error.message;
                break;
        }

        showStatus(message, true);
    }
}

// Click handler
loginBtn.addEventListener("click", handleLogin);

// Allow Enter to submit from email or password inputs
[emailInput, passwordInput].forEach(input => {
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleLogin(e);
        }
    });
});


