# Student Attendance Risk Predictor

A college web portal, themed for **Lovely Professional University**, that tracks attendance, flags students who are at risk of falling below the attendance limit, and tells each student exactly how many classes they can miss or must attend.

**Live demo:** https://adviksingh-code.github.io/Attendance_Project/
**Course:** CSE326 (CA1 project) | **Team:** Byte Builders

## The problem

Colleges usually notice poor attendance only after a student has already missed many classes, so it is too late to help. This portal looks at attendance records early and shows who needs support, before the limit is crossed.

## Features

**Admin**
- First-time setup creates the admin account (no default passwords).
- Dashboard with risk split chart, daily attendance trend and average attendance by program.
- Students table with search, sorting and filters (program, subject, semester, risk level), report export to CSV and print.
- Programs and subjects catalogue (B.Tech, BCA, MCA, BBA, MBA, B.Sc, B.Com and more), with semester-wise subjects. New programs and subjects can be added or removed.
- Attendance entry per subject and date with Present, Absent, Medical leave and Duty leave. CSV import for bulk entry.
- Alerts for students at risk, with message copy, WhatsApp and email links.
- Faculty approval, student add, edit, remove and CSV import, password clearing, backup and restore.

**Student**
- Create an account with a registration number, sign in and see attendance for every subject of their program and semester.
- **Bunk calculator:** how many more classes can be missed while staying above the limit.
- **Semester forecast:** best possible final percentage from the classes that are left.
- Day by day heatmap and recent class history.

**Faculty**
- Request an account, which the admin approves. Faculty can mark attendance and see students only for their own subjects.

Students and faculty can only change their own password. Everything else is admin only.

## How the risk is decided

| Level | Rule (default limit 75%) |
|---|---|
| Safe | attendance is at or above the limit |
| Watch | within 10 points below the limit |
| High risk | more than 10 points below the limit |

Classes needed to recover: `ceil((limit x held - 100 x attended) / (100 - limit))`
Classes that can still be missed: `floor(100 x attended / limit - held)`
Medical and duty leave count as present.

## Technologies

- HTML, CSS and JavaScript (three separate files, no framework)
- SVG for the logo and charts
- Firebase Realtime Database (REST API) so data is shared across phones
- GitHub Pages for hosting

## Project structure

| File | What it contains |
|---|---|
| `index.html` | Page structure (sign-in, setup and app shell), logo symbol, and the `server-url` line for the database |
| `style.css` | Design tokens, layout, components, light and dark theme, responsive rules |
| `app.js` | All logic: data, accounts and roles, attendance maths, views, charts, CSV import, server sync |
| `README.md` | This file |

Keep the three files in the same folder, because `index.html` loads `style.css` and `app.js` from it.

## Run it

1. Open `index.html` in a browser, or use the live demo link above.
2. The first visit shows **Set up your portal**. Create the admin account. Tick the sample data option for a demo.
3. Students and faculty create their own accounts from the sign-in page.

### Shared data (backend)

`index.html` has this line near the top:

```html
<meta name="server-url" content="https://YOUR-DATABASE.firebasedatabase.app">
```

With a Firebase Realtime Database URL there, every phone sees the same data and the admin sidebar shows "Synced with server". With the line empty the site works in local mode and keeps data in that browser only. Realtime Database rules used:

```json
{ "rules": { "abp": { ".read": true, ".write": true } } }
```

## Limitations

This is a student prototype. Permissions are enforced in the browser, and the Firebase rules are open for the `abp` path, so it is not meant for real student records. A production version needs server-side login and strict database rules.

## Team Byte Builders

| Name | Registration No. |
|---|---|
| Saharsh Aggarwal (Leader) | 12615099 |
| Saksham Narang | 12616468 |
| Advik Singh Parmar | 12615220 |
