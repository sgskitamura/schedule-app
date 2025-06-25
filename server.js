// server.js
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const admin = require('firebase-admin'); 
const path = require('path');
const cors = require('cors');
require('dotenv').config();

if (admin.apps.length === 0) {
    try {
        let serviceAccount;
        if (process.env.SERVICE_ACCOUNT_KEY_JSON) {
            serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY_JSON);
        } else {
            serviceAccount = require('./serviceAccountKey.json');
        }
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
    } catch(e) {
        console.error("Firebase Admin SDKの初期化に失敗しました:", e);
    }
}

const db = admin.firestore();
const app = express();

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
    callbackURL: process.env.GOOGLE_CALLBACK_URL // ★ 環境変数で切り替え
  },
  async (accessToken, refreshToken, profile, done) => {
    const userRef = db.collection('users').doc(profile.id);
    const userData = {
      id: profile.id, displayName: profile.displayName, email: profile.emails[0].value,
      accessToken: accessToken, refreshToken: refreshToken || null,
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
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/');
    });
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