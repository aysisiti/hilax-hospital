// ===== Show login overlay =====
function showOverlay(sectionId){
    document.getElementById(sectionId).style.display = 'flex';
    window.scrollTo(0,0);
}

// ===== Close overlay =====
function closeOverlay(){
    document.getElementById('login').style.display = 'none';
    document.getElementById('login-msg').textContent = '';
}

// ===== Scroll back to home =====
function scrollToHome(){
    closeOverlay();
    window.scrollTo(0,0);
}
