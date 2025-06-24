const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const admin = require('firebase-admin'); 
const path = require('path');
const cors = require('cors');
require('dotenv').config();

try {
    let serviceAccount;
    // Vercel環境ではBase64エンコードされたキーをデコード
    if (process.env.SERVICE_ACCOUNT_KEY_B64) {
        const decodedKey = Buffer.from(process.env.SERVICE_ACCOUNT_KEY_B64, 'base64').toString('utf-8');
        serviceAccount = JSON.parse(decodedKey);
    } 
    // ローカル環境ではファイルを直接読み込む
    else {
        serviceAccount = require('./serviceAccountKey.json');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
} catch(e) {
    console.error("Firebase Admin SDKの初期化に失敗しました:", e);
    process.exit(1);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

app.use(session({
  secret: process.env.SESSION_SECRET || 'a-very-secret-key-that-is-long-enough-for-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto' } 
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    const userRef = db.collection('users').doc(profile.id);
    const userData = {
      id: profile.id,
      displayName: profile.displayName,
      email: profile.emails[0].value,
      accessToken: accessToken,
      refreshToken: refreshToken || null,
    };
    await userRef.set(userData, { merge: true });
    return done(null, userData);
  }
));

passport.serializeUser((user, done) => { done(null, user.id); });
passport.deserializeUser(async (id, done) => {
  try {
      const userDoc = await db.collection('users').doc(id).get();
      if (userDoc.exists) { done(null, userDoc.data()); } 
      else { done(new Error('User not found.')); }
  } catch(error) {
      done(error);
  }
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events.readonly'], accessType: 'offline', prompt: 'consent' }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res, next) => {
    req.logout(function(err) { if (err) { return next(err); } res.redirect('/'); });
});

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, user: { displayName: req.user.displayName, id: req.user.id } });
    } else {
        res.json({ loggedIn: false });
    }
});

app.get('/api/settings', (req, res) => { /* ... */ });
app.post('/api/settings', (req, res) => { /* ... */ });

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
      console.log(`サーバーがポート${PORT}で起動しました。`);
    });
}
