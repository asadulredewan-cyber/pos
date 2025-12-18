import { initLayout } from "./layout.js";
import { auth, db } from "../../firebase/config.js";
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

async function refreshCurrentUserFromFirebase() {
    const user = auth.currentUser;
    if (!user) return;

    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;

    currentUserData = {
        uid: user.uid,
        ...snap.data()
    };

    // cache update (secondary)
    localStorage.setItem("pos_user", JSON.stringify(currentUserData));
}
// লেআউট ইনিশিয়ালাইজেশন
initLayout("User & Management");

const MAX_IMAGE_SIZE_KB = 200;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_KB * 1024;
let currentUserData = JSON.parse(localStorage.getItem("pos_user")) || {};
let allEmployees = [];
let allShops = [];

// DOM Elements
const managementView = document.getElementById('managementView');
const userModal = document.getElementById("userModal");
const shopModal = document.getElementById("shopModal");
const passwordModal = document.getElementById("passwordModal");
const userForm = document.getElementById("userForm");
const shopForm = document.getElementById("shopForm");
const passwordChangeForm = document.getElementById("passwordChangeForm");

// ===================================
// সব ইউজার ডাটা একবার নিয়ে আসা (এমপ্লয়ি কাউন্ট করার জন্য)
// ===================================

async function fetchAllUserData() {
    try {
        const snapshot = await getDocs(collection(db, "users"));
        allEmployees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
        console.error("User fetch error:", e);
    }
}

// ===================================
// 1. INITIAL LOAD & UI SETUP
// ===================================
async function loadInitialUI() {
    await refreshCurrentUserFromFirebase();   // 🔥 MUST

    loadProfileData();

    if (currentUserData.role === 'admin' || currentUserData.role === 'manager') {
        if (managementView) managementView.style.display = 'block';

        await fetchAllUserData();   // employees
        await loadAllShops();       // shops (now live)

        const tabShops = document.getElementById('tabShops');
        if (tabShops) {
            tabShops.style.display = (currentUserData.role === 'admin') ? 'block' : 'none';
        }

        loadEmployees();
    }
}

// এটি আপনার গ্লোবাল স্কোপে বা loadInitialUI এর আশেপাশে রাখতে পারেন
document.getElementById('uShopsSelect').addEventListener('change', function() {
    const role = document.getElementById('uRole').value;
    if (role === 'seller' && this.selectedOptions.length > 1) {
       showToast(
            "⚠️ সেলার শুধুমাত্র ১টি দোকানে কাজ করতে পারবে।",
            "error"
        );
        // অতিরিক্ত সিলেকশন রিমুভ করা (Optional)
        this.selectedOptions[this.selectedOptions.length - 1].selected = false;
    }
});



function loadProfileData() {
    const setElementText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text || 'N/A';
    };

    setElementText('profileNameDisplay', currentUserData.name);
    setElementText('profileEmail', currentUserData.email);
    setElementText('profilePhone', currentUserData.phone);
    setElementText('profileRoleDisplay', currentUserData.role);
    setElementText('profileRoleDetail', currentUserData.role);

    // 🔥 সমাধান: shopId এর বদলে shops array থেকে নাম দেখাবে
    let shopNames = (currentUserData.shops && Array.isArray(currentUserData.shops) && currentUserData.shops.length > 0) 
                    ? currentUserData.shops.join(', ') 
                    : (currentUserData.shopId || 'None');
    
    setElementText('profileShops', shopNames);

    const preview = document.getElementById('profileImagePreview');
    if (currentUserData.profilePic && preview) {
        preview.style.backgroundImage = `url(${currentUserData.profilePic})`;
    }
}
// ===================================
// 2. IMAGE UPLOAD & BASE64
// ===================================
const uploadBtn = document.getElementById('uploadBtn');
if (uploadBtn) {
    uploadBtn.addEventListener('click', () => document.getElementById('imageUploadInput').click());
}

const imageInput = document.getElementById('imageUploadInput');
if (imageInput) {
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            alert(`File size must be under ${MAX_IMAGE_SIZE_KB} KB.`);
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64String = event.target.result;
            const preview = document.getElementById('profileImagePreview');
            if (preview) preview.style.backgroundImage = `url(${base64String})`;
            await saveProfilePicture(base64String);
        };
        reader.readAsDataURL(file);
    });
}

async function saveProfilePicture(base64String) {
    try {
        const uid = auth.currentUser.uid;
        await updateDoc(doc(db, "users", uid), { profilePic: base64String });
        currentUserData.profilePic = base64String;
        localStorage.setItem("pos_user", JSON.stringify(currentUserData));
        alert("✅ প্রোফাইল ছবি আপডেট হয়েছে।");
    } catch (error) {
        alert("❌ ছবি সেভ করতে সমস্যা হয়েছে।");
    }
}

// ===================================
// 3. PASSWORD CHANGE
// ===================================
window.openPasswordModal = () => {
    if (passwordChangeForm) passwordChangeForm.reset();
    const status = document.getElementById('passwordStatus');
    if (status) status.innerText = '';
    if (passwordModal) passwordModal.style.display = "flex";
};

window.closePasswordModal = () => {
    if (passwordModal) passwordModal.style.display = "none";
};

if (passwordChangeForm) {
    passwordChangeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPass = document.getElementById('oldPassword').value;
        const newPass = document.getElementById('newPassword').value;
        const confirmPass = document.getElementById('confirmPassword').value;
        const status = document.getElementById('passwordStatus');

        if (newPass.length < 6) {
            status.innerText = "❌ পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।";
            status.style.color = 'red';
            return;
        }
        if (newPass !== confirmPass) {
            status.innerText = "❌ পাসওয়ার্ড মিলছে না।";
            status.style.color = 'red';
            return;
        }

        status.innerText = "যাচাই ও আপডেট হচ্ছে...";
        status.style.color = 'orange';

        try {
            const user = auth.currentUser;
            const credential = EmailAuthProvider.credential(user.email, oldPass);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPass);

            status.innerText = "✅ পাসওয়ার্ড সফলভাবে আপডেট হয়েছে!";
            status.style.color = 'green';
            passwordChangeForm.reset();
            setTimeout(window.closePasswordModal, 3000);
        } catch (error) {
            let msg = "";
            switch (error.code) {
                case "auth/wrong-password":
                case "auth/invalid-login-credentials": msg = "❌ বর্তমান পাসওয়ার্ডটি ভুল!"; break;
                case "auth/network-request-failed": msg = "📡 ইন্টারনেট নেই!"; break;
                default: msg = "⚠ ত্রুটি: " + error.message;
            }
            status.innerText = msg;
            status.style.color = 'red';
        }
    });
}

// ===================================
// 4. MANAGEMENT TABS
// ===================================
window.switchManagementTab = (tabName) => {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const btn = document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    const content = document.getElementById(`${tabName}Tab`);
    if (btn) btn.classList.add('active');
    if (content) content.classList.add('active');
    
    if (tabName === 'employee') loadEmployees();
    if (tabName === 'shops') loadAllShops();
};

// ===================================
// 5. EMPLOYEE MANAGEMENT (CRUD)
// ===================================
async function loadEmployees() {
    const tableBody = document.getElementById('employeeTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="4">লোডিং ডাটা...</td></tr>';

    try {
        const myPrimaryShopId = currentUserData.shopId || currentUserData.shopid;
        const myPermittedShops = currentUserData.shops || []; 

        if (!myPrimaryShopId) {
            tableBody.innerHTML = '<tr><td colspan="4">আপনার কোনো শপ আইডি সেট করা নেই।</td></tr>';
            return;
        }

        const filtered = allEmployees.filter(u => {
            if (u.id === currentUserData.uid) return false;
            
            const targetRole = (u.role || '').toLowerCase();
            const targetPrimaryId = u.shopId || u.shopid;
            const targetShops = u.shops || []; 

            // ১. মেইন shopId অবশ্যই মিলতে হবে
            if (targetPrimaryId !== myPrimaryShopId) return false;

            // ২. রোল চেক: এডমিনদের লিস্টে দেখাবে না
            if (targetRole === 'admin') return false;

            // ৩. 🔥 বিশেষ লজিক: 
            // যদি সেলারের 'shops' অ্যারে খালি থাকে, তবে তাকে মেইন 'shopId' এর ভিত্তিতে কাউন্ট করবে।
            // আর যদি ডাটা থাকে, তবে ম্যানেজারের অনুমোদিত দোকানের সাথে মিল খুঁজবে।
            const hasCommonShop = targetShops.length === 0 ? true : targetShops.some(shopName => myPermittedShops.includes(shopName));

            if (currentUserData.role === 'manager') {
                return targetRole === 'seller' && hasCommonShop;
            }

            return hasCommonShop;
        });

        renderEmployeeTable(filtered);
    } catch (error) {
        console.error("Filter Error:", error);
        tableBody.innerHTML = `<tr><td colspan="4" style="color:red;">ডাটা লোড ব্যর্থ।</td></tr>`;
    }
}
function renderEmployeeTable(employees) {
    const tableBody = document.getElementById('employeeTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    employees.forEach(u => {
        // 🔥 লজিক পরিবর্তন: আগে shops অ্যারের ডাটা চেক করবে, না থাকলে shopId দেখাবে
        const shopsDisplay = (u.shops && Array.isArray(u.shops) && u.shops.length > 0) 
                             ? u.shops.join(', ') 
                             : (u.shopId || 'N/A');
        
        const row = `
            <tr>
                <td><strong>${u.name}</strong><br><span class="role-badge-table ${u.role}">${u.role}</span></td>
                <td>${u.email || 'N/A'}<br><small>${u.phone || ''}</small></td>
                <td>${shopsDisplay}</td> <td>
                    <button class="btn-action btn-edit" onclick="window.editUser('${u.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn-action btn-delete" onclick="window.deleteUser('${u.id}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        tableBody.innerHTML += row;
    });

    if (employees.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4">কোনো এমপ্লয়ি পাওয়া যায়নি।</td></tr>';
    }
}
window.deleteUser = (id) => {
    showConfirmToast(
        "⚠️ আপনি কি নিশ্চিত এই ইউজারকে ডিলিট করতে চান?",
        async () => {
            try {
                await deleteDoc(doc(db, "users", id));

                showToast("🗑️ ইউজার ডিলিট হয়েছে", "error");

                await fetchAllUserData();
                loadEmployees();
                if (typeof loadAllShops === "function") loadAllShops();

            } catch (error) {
                console.error("Delete Error:", error);
                showToast("❌ ডিলিট করা যায়নি", "error");
            }
        }
    );
};

// ===================================
// 6. SHOP MANAGEMENT (আপনার স্ট্রিক্ট লজিক অনুযায়ী আপডেট)
// ===================================

// ১. ইউজারের প্রোফাইল থেকে শপ লোড করা
async function loadAllShops() {
    try {
        await refreshCurrentUserFromFirebase();   // 🔥 live fetch

        const shopNames = currentUserData.shops || [];
        const myPrimaryShopId = currentUserData.shopId || currentUserData.shopid;

        renderShopTable(shopNames, myPrimaryShopId);

    } catch (e) {
        console.error("Shop load error:", e);
    }
}


// ২. শপ টেবিল রেন্ডারিং
function renderShopTable(shopNames, myPrimaryShopId) {
    const tableBody = document.getElementById('shopTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    shopNames.forEach(sName => {
        // 🔥 স্ট্রিক্ট এমপ্লয়ি কাউন্ট লজিক: 
        // এডমিন বাদ + নিজের shopId ম্যাচ + ওই ইউজারের shops অ্যারেতে দোকানের নাম থাকতে হবে
        const empCount = allEmployees.filter(u => {
            const userRole = (u.role || '').toLowerCase();
            const userPrimaryId = u.shopId || u.shopid;
            const userAccessList = u.shops || [];

            return userRole !== 'admin' && 
                   userPrimaryId === myPrimaryShopId && 
                   userAccessList.includes(sName);
        }).length;

        
        tableBody.innerHTML += `
            <tr>
                <td><strong>${sName}</strong></td> 
                <td>${empCount} জন</td> 
                <td>
                    <button class="btn-action btn-delete" onclick="window.deleteShop('${sName}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
    });

    if (shopNames.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3">কোনো দোকান পাওয়া যায়নি।</td></tr>';
    }
}

// ===================================
// UTILS & MODALS & FORM SUBMIT
// ===================================
window.editUser = (id) => {
    const user = allEmployees.find(u => u.id === id);
    if (!user) return;

    document.getElementById("editUserId").value = user.id;
    document.getElementById("uName").value = user.name || '';
    document.getElementById("uPhone").value = user.phone || '';
    document.getElementById("uEmail").value = user.email || '';
    document.getElementById("uEmail").disabled = true;

    // 🔥 পাসওয়ার্ড ফিল্ড এবং এর লেবেল পুরোপুরি লুকিয়ে ফেলুন
    const passInput = document.getElementById("uPassword");
    if (passInput) {
        passInput.style.display = "none"; // ইনপুট ইনভিজিবল হবে
        passInput.required = false; 
        
        // ইনপুটের ঠিক উপরে থাকা "পাসওয়ার্ড *" লেবেলটি লুকাবে
        const label = passInput.previousElementSibling;
        if (label && (label.tagName === 'LABEL' || label.innerText.includes('পাসওয়ার্ড'))) {
            label.style.display = "none";
        }
    }

    // বাকি লজিক (রোল সেটআপ এবং শপ সিলেকশন)...
    const roleSelect = document.getElementById("uRole");
    if (currentUserData.role === 'manager') roleSelect.innerHTML = '<option value="seller">Seller</option>';
    roleSelect.value = user.role || 'seller';
    populateShopDropdownFromList(currentUserData.shops || []);
    const shopSelect = document.getElementById("uShopsSelect");
    if (shopSelect) {
        const userShops = user.shops || [];
        Array.from(shopSelect.options).forEach(option => {
            option.selected = userShops.includes(option.value);
        });
    }

    document.getElementById("userModalTitle").innerText = "ইউজার তথ্য আপডেট করুন";
    document.getElementById("userModal").style.display = "flex";
};

if (userForm) {
    userForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const editId = document.getElementById("editUserId").value;
        const role = document.getElementById("uRole").value;
        const shopSelect = document.getElementById("uShopsSelect");
        const selectedShops = Array.from(shopSelect.selectedOptions).map(opt => opt.value);
        
        // 🔥 লজিক: নতুন ইউজারের shopId হবে আপনার (লগইন করা ইউজার) shopId
        const myPrimaryShopId = currentUserData.shopId || currentUserData.shopid;

        // 🔥 লজিক: সেলার সিলেক্ট করলে ১টির বেশি দোকান এক্সেস দেওয়া যাবে না
        if (role === 'seller' && selectedShops.length > 1) {
            alert("❌ একজন সেলারকে শুধুমাত্র ১টি দোকানে অ্যাসাইন করা যাবে।");
            return;
        }

        try {
            const commonData = {
                name: document.getElementById("uName").value,
                phone: document.getElementById("uPhone").value,
                role: role,
                shops: selectedShops // সিলেক্ট করা শপগুলো অ্যারে হিসেবে যাবে
            };

            if (editId) {
                // ইউজার আপডেট করার সময় মেইন shopId স্থির রাখা হচ্ছে
                const userDoc = allEmployees.find(u => u.id === editId);
                const currentShopId = userDoc ? (userDoc.shopId || userDoc.shopid) : myPrimaryShopId;

                const updateData = {
                    ...commonData,
                    shopId: currentShopId,
                    shopid: currentShopId
                };

                await updateDoc(doc(db, "users", editId), updateData);
               showToast("✅ ইউজার তথ্য আপডেট হয়েছে", "success");
            } else {
                // নতুন ইউজার তৈরির সময় আপনার shopId টি তাকে দেওয়া হচ্ছে
                const newUser = {
                    ...commonData,
                    email: document.getElementById("uEmail").value,
                    shopId: myPrimaryShopId,
                    shopid: myPrimaryShopId,
                    createdAt: serverTimestamp()
                };

                const userCred = await createUserWithEmailAndPassword(auth, newUser.email, document.getElementById("uPassword").value);
                await setDoc(doc(db, "users", userCred.user.uid), newUser);
               showToast("🎉 নতুন ইউজার যোগ হয়েছে", "success");

            }

            window.closeUserModal();
            await fetchAllUserData(); // কাউন্ট আপডেট করার জন্য পুনরায় সব ডাটা ফেচ
            loadEmployees(); // এমপ্লয়ি টেবিল রিফ্রেশ
            if (typeof loadAllShops === "function") loadAllShops(); // শপ টেবিল কাউন্ট রিফ্রেশ

        } catch (error) {
            console.error("Submission Error:", error);
          showToast("❌ অপারেশন ব্যর্থ হয়েছে", "error");

        }
    });
}

function populateShopDropdownFromList(shopNames) {
    const selector = document.getElementById('uShopsSelect');
    if (!selector) return;
    selector.innerHTML = '';
    shopNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.innerText = name;
        selector.appendChild(option);
    });
}
window.openUserModal = () => {
    if (userForm) userForm.reset();
    document.getElementById("editUserId").value = "";
    document.getElementById("uEmail").disabled = false;
    document.getElementById("userModalTitle").innerText = "নতুন ইউজার যোগ করুন";
    
    // 🔥 পাসওয়ার্ড ফিল্ড এবং এর লেবেল দেখান
    const passInput = document.getElementById("uPassword");
    if (passInput) {
        passInput.style.display = "block"; 
        passInput.required = true; 
        // ইনপুটের উপরের লেবেল বা টেক্সট দেখানোর জন্য
        if (passInput.previousElementSibling) {
            passInput.previousElementSibling.style.display = "block";
        }
    }

    // রোল এবং শপ ড্রপডাউন সেটআপ আগের মতই থাকবে...
    const roleSelect = document.getElementById("uRole");
    if (currentUserData.role === 'manager') {
        roleSelect.innerHTML = '<option value="seller">Seller</option>';
    } else {
        roleSelect.innerHTML = '<option value="seller">Seller</option><option value="manager">Manager</option><option value="admin">Admin</option>';
    }
    populateShopDropdownFromList(currentUserData.shops || []);
    if (userModal) userModal.style.display = "flex";
};

window.openShopModal = () => {
    if (shopForm) shopForm.reset();
    document.getElementById("editShopId").value = "";
    document.getElementById("shopModalTitle").innerText = "নতুন দোকান যোগ করুন";
    if (shopModal) shopModal.style.display = "flex";
};



window.closeUserModal = () => {
    if (userModal) userModal.style.display = "none";
};
window.closeShopModal = () => {
    if (shopModal) shopModal.style.display = "none";
};

window.onclick = function(event) {
    if (event.target == userModal) window.closeUserModal();
    if (event.target == shopModal) window.closeShopModal();
    if (event.target == passwordModal) window.closePasswordModal();
};




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
    if (document.querySelector(".confirm-toast")) return;

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
    toast.querySelector(".btn-delete").focus();

    const cleanup = () => toast.remove();

    toast.querySelector(".btn-delete").onclick = () => {
        onConfirm();
        cleanup();
    };

    toast.querySelector(".btn-cancel").onclick = cleanup;
}

if (shopForm) {
    shopForm.addEventListener("submit", (e) => {
        e.preventDefault();
        window.addNewShopToUser();
        
    });
}



// ১. দোকান যোগ করার কাস্টম প্রম্পট এবং সেভ লজিক
window.addNewShopToUser = async () => {
    
    const shopName = document.getElementById("sShopId").value;

    
    if (!shopName || shopName.trim() === "") {
        showToast("⚠️ দোকানের নাম ফাঁকা রাখা যাবে না!", "error");
        return;
    }

    try {
        const uid = auth.currentUser.uid;
        const userRef = doc(db, "users", uid);

        // ১. সরাসরি লোকাল ডাটা থেকেই বর্তমান শপগুলো নিন
        let existingShops = Array.isArray(currentUserData.shops) ? [...currentUserData.shops] : [];

        if (existingShops.includes(shopName.trim())) {
            showToast("❌ এই দোকানটি ইতিমধ্যে তালিকায় আছে।", "error");
            return;
        }

        // ২. অ্যারে আপডেট
        existingShops.push(shopName.trim());

        // ৩. ফায়ারস্টোর আপডেট
        await updateDoc(userRef, {
            shops: existingShops
        });

        // ৪. গ্লোবাল ডাটা এবং লোকাল স্টোরেজ আপডেট (সবচাইতে জরুরি)
        await loadAllShops();   // Firebase → UI

document.getElementById("sShopId").value = "";
window.closeShopModal();
    } catch (error) {
        console.error("Shop Save Error:", error);
        showToast("❌ দোকান সেভ করতে সমস্যা হয়েছে।", "error");
    }
    showToast(`✅ "${shopName}" সফলভাবে যোগ হয়েছে!`, "success");

};
window.deleteShop = (shopName) => {
    showConfirmToast(
        `⚠️ "${shopName}" দোকানটি ডিলিট করবেন?`,
        async () => {
            try {
                const uid = auth.currentUser.uid;
                const userRef = doc(db, "users", uid);

                await refreshCurrentUserFromFirebase();

                const updatedShops = (currentUserData.shops || [])
                    .filter(s => s !== shopName);

                await updateDoc(userRef, {
                    shops: updatedShops
                });

                await loadAllShops();

                showToast(`🗑️ "${shopName}" ডিলিট হয়েছে`, "success");
            } catch (err) {
                console.error(err);
                showToast("❌ দোকান ডিলিট করা যায়নি", "error");
            }
        }
    );
};



// Initial Load
loadInitialUI();