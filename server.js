require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('.')); // Serve static HTML files from the current folder

// Connect to MongoDB using Atlas URL in .env
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ FATAL: MONGODB_URI is not defined in .env');
    console.error('   Please ensure you have a .env file with MONGODB_URI=your_url');
    process.exit(1);
}

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err.message);
        console.error('   Check your Internet connection and IP Whitelist in Atlas.');
    });

// --- SMTP CONFIGURATION ---
const smtpPort = parseInt(process.env.SMTP_PORT || 587);
const smtpHost = process.env.SMTP_HOST || 'smtp.office365.com';
const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465, false for 587 (STARTTLS)
    requireTLS: smtpPort === 587,
    auth: {
        user: process.env.SMTP_USER || 'info@danprel.com',
        pass: process.env.SMTP_PASS || ''
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verify connection
transporter.verify((error, success) => {
    if (error) {
        console.error('📧 [SMTP] Connection Error:', error);
    } else {
        console.log('📧 [SMTP] Ready to send emails');
    }
});

// --- DATA SCHEMA ---
const ProjectSchema = new mongoose.Schema({
    code: String,
    name: String,
    customer_name: String,
    sat_location: String,
    po_date: String,
    po_value: Number,
    project_manager: String,
    description: String,
    start_date: String,
    dispatch_date: String,
    mq2_date: String,
    reassign_start_date: String,
    reassign_dispatch_date: String,
    reassign_mq2_date: String,
    overall_progress: { type: Number, default: 0 },
    plan_status: { type: String, default: 'pending' },
    status: { type: String, default: 'Started' },
    current_phase: { type: String, default: 'Phase 1: Project Kick Off' },
    detailed_phases: { type: mongoose.Schema.Types.Mixed, default: {} },
    phases: [
        { name: String, progress: { type: Number, default: 0 } }
    ],
    // For Review Meetings
    meetings: [
        {
            id: String,
            reviewDate: String,
            action: String,
            dept: String,
            personName: String,
            email: String,
            targetDate: String,
            statusValue: String,
            nextTarget: String,
            mailSent: Boolean,
            revisions: [
                {
                    date: String,
                    status: String,
                    remark: String,
                    timestamp: String,
                    statusOnly: Boolean
                }
            ]
        }
    ],
    // For Reschedule Requests (Phase Level)
    revision_requests: [
        {
            id: String,
            phaseId: String,
            phaseName: String,
            oldStart: String,
            oldEnd: String,
            newStart: String,
            newEnd: String,
            reason: String,
            timestamp: String,
            status: String, // pending, approved, rejected
            approvedBy: String,
            approvalTimestamp: String
        }
    ]
}, { timestamps: true });

const Project = mongoose.model('Project', ProjectSchema);

const EmployeeSchema = new mongoose.Schema({
    name: String,
    role: String,
    employee_id: String,
    email: String,
    dept: String,
    exp: String
}, { timestamps: true });

const Employee = mongoose.model('Employee', EmployeeSchema);

const FeedbackSchema = new mongoose.Schema({
    content: String,
    sourcePage: String
}, { timestamps: true });
const Feedback = mongoose.model('Feedback', FeedbackSchema);
 
 const ActionPointSchema = new mongoose.Schema({
     projectId: String,
     projectCode: String,
     reviewDate: String,
     action: String,
     dept: String,
     personName: String,
     email: String,
     targetDate: String,
     statusValue: { type: String, default: 'Yet to Start' },
     mailSent: { type: Boolean, default: false },
     revisions: [
         {
             date: String,
             status: String,
             remark: String,
             timestamp: String
         }
     ]
 }, { timestamps: true });
 const ActionPoint = mongoose.model('ActionPoint', ActionPointSchema);


// --- API ENDPOINTS ---

// 1. Get All Projects
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await Project.find().sort({ createdAt: -1 });
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Get Single Project
app.get('/api/projects/:id', async (req, res) => {
    try {
        const p = await Project.findById(req.params.id);
        if (!p) return res.status(404).json({ message: 'Project not found' });
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Create or Update Project
app.post('/api/projects', async (req, res) => {
    try {
        const data = req.body;
        let p;
        if (data._id) {
            p = await Project.findByIdAndUpdate(data._id, data, { returnDocument: 'after' });
        } else {
            p = new Project(data);
            await p.save();
        }
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Update Single Project Specific Fields (Partial Update)
app.patch('/api/projects/:id', async (req, res) => {
    console.log(`📡 [PATCH] /api/projects/${req.params.id} - Fields:`, Object.keys(req.body));
    try {
        const p = await Project.findByIdAndUpdate(req.params.id, { $set: req.body }, { 
            returnDocument: 'after',
            runValidators: true // Ensure schema validation is applied
        });
        if (!p) return res.status(404).json({ error: 'Project not found' });
        res.json(p);
    } catch (err) {
        console.error(`❌ [PATCH] Error:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// 5. Delete Project
app.delete('/api/projects/:id', async (req, res) => {
    try {
        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: 'Project deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ACTION POINT ENDPOINTS (NEW TABLE) ---

// Get all action points for a project
app.get('/api/action-points', async (req, res) => {
    try {
        const { projectId } = req.query;
        const items = await ActionPoint.find(projectId ? { projectId } : {}).sort({ createdAt: -1 });
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new action point
app.post('/api/action-points', async (req, res) => {
    try {
        const ap = new ActionPoint(req.body);
        await ap.save();
        res.json(ap);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update action point
app.patch('/api/action-points/:id', async (req, res) => {
    try {
        const ap = await ActionPoint.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(ap);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete action point
app.delete('/api/action-points/:id', async (req, res) => {
    try {
        await ActionPoint.findByIdAndDelete(req.params.id);
        res.json({ message: 'Action point deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- EMPLOYEE API ENDPOINTS ---

// 1. Get All Employees
app.get('/api/employees', async (req, res) => {
    try {
        const employees = await Employee.find().sort({ createdAt: -1 });
        res.json(employees);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Create or Update Employee
app.post('/api/employees', async (req, res) => {
    console.log(`📥 [POST] /api/employees - Incoming Data:`, req.body);
    try {
        const data = req.body;
        let emp;
        if (data._id) {
            const updateId = data._id;
            const updateData = { ...data };
            delete updateData._id; // Ensure we don't try to update the immutable _id field

            emp = await Employee.findByIdAndUpdate(updateId, updateData, { new: true });
            console.log("✅ Updated Employee:", emp);
        } else {
            emp = new Employee(data);
            await emp.save();
            console.log("✅ Created New Employee:", emp);
        }
        res.json(emp);
    } catch (err) {
        console.error("❌ Save Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. Delete Employee
app.delete('/api/employees/:id', async (req, res) => {
    try {
        await Employee.findByIdAndDelete(req.params.id);
        res.json({ message: 'Employee deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- EMAIL API ENDPOINT ---
app.post('/api/send-email', async (req, res) => {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
        return res.status(400).json({ error: 'Missing to, subject, or body' });
    }

    const mailOptions = {
        from: `"Danprel Engineering Automation" <${process.env.SMTP_USER || 'info@danprel.com'}>`,
        to: to,
        subject: subject,
        text: body,
        html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                <div style="background-color: #001f3f; padding: 24px 32px; text-align: center; border-bottom: 4px solid #0d9488;">
                    <h2 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 1px;">DANPREL</h2>
                    <p style="color: #94a3b8; margin: 4px 0 0; font-size: 13px; text-transform: uppercase; font-weight: 600;">Engineering Automation</p>
                </div>
                <div style="padding: 32px; color: #334155; font-size: 15px; line-height: 1.7;">
                    <div style="background-color: #f8fafc; border-left: 4px solid #0ea5e9; padding: 24px; border-radius: 12px; margin-bottom: 24px; font-family: inherit;">${body.replace(/\n/g, '<br>')}</div>
                    
                    <p style="margin: 0 0 16px 0; font-size: 13px; color: #64748b; font-style: italic;">This is an auto-generated mail, so please do not reply.</p>
                    
                    <p style="margin: 0; color: #475569;">Best Regards,<br>
                    <strong style="color: #0f172a;">Project Team</strong><br>
                    <strong style="color: #0f172a;">DANPREL ENGINEERING AUTOMATION</strong></p>
                </div>
                <div style="background-color: #f1f5f9; padding: 20px 32px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0;">This is an automated notification from the Project Hub.</p>
                </div>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent: ' + info.messageId);
        res.json({ message: 'Email sent successfully', messageId: info.messageId });
    } catch (err) {
        console.error('❌ Email failed:', err);
        res.status(500).json({ error: 'Email could not be sent: ' + err.message });
    }
});

// 12. Submit Feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { content, sourcePage } = req.body;
        if (!content) return res.status(400).json({ message: 'Feedback content is empty' });
        const fb = new Feedback({ content, sourcePage });
        await fb.save();
        res.json({ message: 'Feedback saved successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Catch-all to serve index.html for UI routes
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        console.warn(`⚠️ API Route not found: ${req.method} ${req.path}`);
        return res.status(404).json({ error: `API route ${req.method} ${req.path} not found. Please restart the backend server.` });
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

if (process.env.NODE_ENV !== 'production' || !process.env.NETLIFY) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Server running at http://localhost:${PORT}/`);
        console.log(`MongoDB storage is now active.\n`);
    });
}

// Export for serverless
module.exports = app;
