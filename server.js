require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { hashPassword, verifyPassword, safeEqualText } = require('./auth-utils');

const app = express();
const PORT = 3000;
const LOCAL_SAFE_MODE =
    process.env.LOCAL_SAFE_MODE === 'true';
const ALLOW_LOCAL_EDIT_WRITES =
    process.env.ALLOW_LOCAL_EDIT_WRITES === 'true';
const ALLOW_LOCAL_FEEDBACK_WRITES =
    process.env.ALLOW_LOCAL_FEEDBACK_WRITES === 'true';
const ALLOW_LOCAL_FEEDBACK_REQUIREMENT_WRITES =
    process.env.ALLOW_LOCAL_FEEDBACK_REQUIREMENT_WRITES === 'true';

// Middleware
app.use(express.json());
app.use(cors());
// Block production database changes while working locally.
// Feedback writes are allowed locally only with ALLOW_LOCAL_FEEDBACK_WRITES=true.
const blockedLocalWriteMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use('/api', (req, res, next) => {
    const requestPath = String(req.originalUrl || '').split('?')[0];
    const isLoginRequest =
        req.method === 'POST' && requestPath === '/api/auth/login';
    const isFeedbackWrite =
        (req.method === 'POST' && requestPath === '/api/feedback') ||
        (req.method === 'PATCH' && /^\/api\/feedback\/[^/]+\/status$/.test(requestPath));
    const isCustomerFeedbackRequirementWrite =
        req.method === 'PATCH' &&
        /^\/api\/projects\/[^/]+\/customer-feedback-requirement$/.test(requestPath);
    // PMIS_FILTER_EDIT_PERSISTENCE_V22: optional local testing for edits to existing records only.
    const isExistingRecordEdit =
        (req.method === 'PATCH' && /^\/api\/projects\/[^/]+$/.test(requestPath)) ||
        (req.method === 'PATCH' && /^\/api\/action-points\/[^/]+$/.test(requestPath));
    const isAllowedLocalWrite =
        isLoginRequest ||
        (ALLOW_LOCAL_FEEDBACK_WRITES && isFeedbackWrite) ||
        isCustomerFeedbackRequirementWrite ||
        (ALLOW_LOCAL_EDIT_WRITES && isExistingRecordEdit);

    if (
        LOCAL_SAFE_MODE &&
        blockedLocalWriteMethods.has(req.method) &&
        !isAllowedLocalWrite
    ) {
        console.warn(
            `[LOCAL SAFE MODE] Blocked ${req.method} ${requestPath}`
        );

        return res.status(403).json({
            error: 'Database changes are blocked in local safe mode.'
        });
    }

    next();
});
app.use(express.static('.')); // Serve static HTML files from the current folder // Serve static HTML files from the current folder

// Middleware to prevent browser caching of dynamic API responses
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

// Serverless-safe reusable MongoDB connection.
let mongoConnectPromise = null;

async function ensureMongoConnected() {
    if (mongoose.connection.readyState === 1) {
        return true;
    }

    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI is not configured.');
    }

    if (!mongoConnectPromise) {
        mongoConnectPromise = mongoose.connect(MONGODB_URI)
            .then(() => {
                console.log('✅ Connected to MongoDB Atlas');
                return true;
            })
            .catch((err) => {
                console.error('❌ MongoDB Connection Error:', err.message);
                throw err;
            })
            .finally(() => {
                mongoConnectPromise = null;
            });
    }

    await mongoConnectPromise;

    if (mongoose.connection.readyState !== 1) {
        throw new Error(
            `MongoDB did not reach connected state. Current state: ${mongoose.connection.readyState}`
        );
    }

    return true;
}

// Warm the connection on function/container startup.
if (MONGODB_URI) {
    ensureMongoConnected().catch(() => {});
} else {
    console.warn('⚠️ MONGODB_URI not found. Database features will be disabled.');
}

// --- SMTP CONFIGURATION ---
const smtpPort = parseInt(process.env.SMTP_PORT || 465);

// Temporary store for reset codes (In-Memory)
const resetCodes = new Map();
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verify connection
if (!LOCAL_SAFE_MODE) {
    transporter.verify((error) => {
        if (error) {
            console.error(
                '[SMTP] Connection Error:',
                error.message
            );

            if (!process.env.SMTP_USER) {
                console.error(
                    '[SMTP] SMTP_USER is missing.'
                );
            }
        } else {
            console.log('[SMTP] Connected and ready');
        }
    });
} else {
    console.log(
        '[LOCAL SAFE MODE] SMTP verification disabled.'
    );
}

// --- DATA SCHEMA ---
const ProjectSchema = new mongoose.Schema({
    tracking_code: String,
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
    // PMIS_REPORT_LAYOUT_FEEDBACK_NA_V19
    customer_feedback_requirement: {
        type: String,
        enum: ['required', 'not_required'],
        default: 'required'
    },
    customer_feedback_requirement_updated_at: Date,
    customer_feedback_requirement_updated_by: { type: String, default: '' },
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
    // PMIS_LESSONS_LEARNED_REGISTER_V32
    // Structured register imported from the Lessons Learned Register format.
    lessons_learned: { type: [mongoose.Schema.Types.Mixed], default: [] },

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
    exp: String,

    // Individual PMIS login fields
    username: { type: String, trim: true, uppercase: true },
    passwordHash: { type: String, select: false },
    authRole: {
        type: String,
        enum: ['project_manager', 'project_coordinator', null],
        default: null
    },
    loginEnabled: { type: Boolean, default: false }
}, { timestamps: true });

EmployeeSchema.index(
    { username: 1 },
    {
        unique: true,
        partialFilterExpression: {
            username: { $type: 'string' }
        }
    }
);

const Employee = mongoose.model('Employee', EmployeeSchema);

// PMIS_PROJECT_FILTER_AND_ADMIN_FEEDBACK_V7
const FeedbackSchema = new mongoose.Schema({
    content: { type: String, required: true, trim: true },
    sourcePage: { type: String, default: 'Unknown' },
    status: {
        type: String,
        enum: ['open', 'wip', 'closed'],
        default: 'open'
    },
    submittedByName: { type: String, default: '' },
    submittedByEmail: { type: String, default: '' },
    submittedByEmployeeId: { type: String, default: '' },
    submittedByUsername: { type: String, default: '' },
    adminNote: { type: String, default: '' },
    statusUpdatedAt: Date,
    statusUpdatedBy: { type: String, default: '' },
    statusHistory: [{
        status: String,
        note: String,
        changedBy: String,
        changedAt: { type: Date, default: Date.now },
        emailNotified: { type: Boolean, default: false }
    }]
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
    reminderSent: { type: Boolean, default: false },
    reminder24Sent: { type: Boolean, default: false },
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

// --- REUSABLE REMINDER FUNCTION ---
async function sendAutoReminder(task, timeLabel) {
    if (!task.email) return;

    const emailBody = `
        <p>Dear <strong>${task.personName}</strong>,</p>
        <p>This is an automated reminder that your task is due in <strong style="color: #ef4444;">${timeLabel}</strong>.</p>
        
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 30px 0;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding-bottom: 10px; color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 700;">Project Code</td>
                </tr>
                <tr>
                    <td style="padding-bottom: 20px; color: #0f172a; font-size: 18px; font-weight: 800;">${task.projectCode}</td>
                </tr>
                <tr>
                    <td style="padding-bottom: 10px; color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 700;">Action Item</td>
                </tr>
                <tr>
                    <td style="padding-bottom: 20px; color: #0f172a; font-size: 16px; font-weight: 600; line-height: 1.5;">${task.action}</td>
                </tr>
                <tr>
                    <td style="padding-bottom: 10px; color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 700;">Target Deadline</td>
                </tr>
                <tr>
                    <td style="color: #ef4444; font-size: 18px; font-weight: 800;">${task.targetDate}</td>
                </tr>
            </table>
        </div>

        <p>Please ensure all necessary work is on track for completion. If the task is already completed, kindly update the dashboard or inform the project manager.</p>
    `;

    const mailOptions = {
        from: `Danprel Reminders <${process.env.SMTP_USER}>`,
        to: task.email,
        subject: `URGENT: Task Reminder [${timeLabel}] - ${task.projectCode}`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
                .wrapper { width: 100%; background-color: #ffffff; padding: 40px 0; }
                .container { max-width: 600px; margin: 0 auto; padding: 0 20px; }
                .header { border-bottom: 2px solid #f8fafc; padding-bottom: 25px; margin-bottom: 35px; }
                .logo { width: 54px; height: auto; margin-bottom: 12px; }
                .company-name { font-size: 15px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 1.5px; margin: 0; }
                .content { font-size: 16px; line-height: 1.6; color: #334155; }
                .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: left; }
                .footer-text { font-size: 12px; color: #94a3b8; line-height: 1.5; }
            </style>
        </head>
        <body>
            <div class="wrapper">
                <div class="container">
                    <div class="header">
                        <img src="https://danprelpmis.netlify.app/asset/image.png" alt="Danprel" class="logo">
                        <h1 class="company-name">Danprel Engineering Automation Pvt Ltd</h1>
                    </div>
                    <div class="content">
                        ${emailBody}
                    </div>
                    <div class="footer">
                        <p class="footer-text">
                            <strong>Danprel Engineering Automation Pvt Ltd</strong><br>
                            This is an automated system message. Please do not reply directly to this email.<br>
                            &copy; 2026 All rights reserved.
                        </p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `
    };
    await transporter.sendMail(mailOptions);
    console.log(`📨 ${timeLabel} Reminder sent to ${task.email}`);
}

// --- DATE UTILITY FUNCTIONS ---
function parseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
    dateStr = String(dateStr).trim();
    if (dateStr === 'Select Date' || dateStr === '- Not Set -' || dateStr === '—' || dateStr === '') {
        return null;
    }
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            const d = new Date(year, month, day);
            if (!isNaN(d.getTime())) return d;
        }
    }
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const day = parseInt(parts[2], 10);
                const d = new Date(year, month, day);
                if (!isNaN(d.getTime())) return d;
            } else {
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const year = parseInt(parts[2], 10);
                const d = new Date(year, month, day);
                if (!isNaN(d.getTime())) return d;
            }
        }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateLocalISO(date) {
    if (!date) return '';
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * calcCpmDuration(items)
 * 
 * Proper CPM: groups overlapping (parallel) sub-phases together,
 * takes the MAX duration within each group, then SUMs across sequential groups.
 * Gaps between sub-phases are NOT counted.
 * 
 * Returns { totalDuration, pStart } where pStart is the earliest start date.
 */
function calcCpmDuration(items) {
    // Filter to only items that have both start and end
    const valid = items.filter(item => item.start && item.end && item.duration > 0);
    if (valid.length === 0) {
        // Fall back to duration-only items if no dates
        const durOnly = items.filter(item => item.duration > 0);
        const total = durOnly.reduce((sum, item) => sum + item.duration, 0);
        return { totalDuration: total, pStart: null };
    }

    // Sort by start date
    const sorted = [...valid].sort((a, b) => a.start - b.start);

    // Group overlapping items (parallel) - merge intervals
    const groups = [];
    let currentGroup = [sorted[0]];
    let currentGroupEnd = sorted[0].end;

    for (let i = 1; i < sorted.length; i++) {
        const item = sorted[i];
        // If this item starts before the current group's latest end → overlapping (parallel)
        if (item.start <= currentGroupEnd) {
            currentGroup.push(item);
            if (item.end > currentGroupEnd) currentGroupEnd = item.end;
        } else {
            // Sequential: start a new group
            groups.push(currentGroup);
            currentGroup = [item];
            currentGroupEnd = item.end;
        }
    }
    groups.push(currentGroup);

    // For each group: take the max duration
    // For sequential groups: sum them up
    let totalDuration = 0;
    for (const group of groups) {
        const maxDur = group.reduce((max, item) => Math.max(max, item.duration), 0);
        totalDuration += maxDur;
    }

    const pStart = new Date(Math.min(...valid.map(item => item.start)));
    return { totalDuration, pStart };
}

// --- DATA AUTO-CORRECTION (Fixes dates for rescheduled tasks) ---
async function syncDataOnStartup() {
    console.log('🔧 Running Data Sync Check...');
    try {
        const allTasks = await ActionPoint.find({ 'revisions.0': { $exists: true } });
        let fixedCount = 0;
        for (const task of allTasks) {
            const latestRev = [...task.revisions].filter(r => r.date).pop();
            if (latestRev && latestRev.date && latestRev.date !== task.targetDate) {
                console.log(`   └─ Correcting: ${task.action} (${task.targetDate} -> ${latestRev.date})`);
                task.targetDate = latestRev.date;
                await task.save();
                fixedCount++;
            }
        }
        console.log(`✅ Data Sync Complete. ${fixedCount} records updated.`);

        // --- PROJECT DATES AGGREGATION & CLEANUP ---
        console.log('🔧 Auditing Project Timeline Dates...');
        const projects = await Project.find();
        let projFixed = 0;

        const defaultPhases = [
            { id: 'kickoff_1', parent: 'kickoff' }, { id: 'kickoff_2', parent: 'kickoff' },
            { id: 'design_1', parent: 'design' }, { id: 'design_2', parent: 'design' },
            { id: 'design_critical_approval', parent: 'design' }, { id: 'design_3', parent: 'design' },
            { id: 'design_4', parent: 'design' }, { id: 'design_5', parent: 'design' },
            { id: 'design_6', parent: 'design' }, { id: 'purchase_1', parent: 'purchase' },
            { id: 'purchase_2', parent: 'purchase' }, { id: 'mech_assembly_1', parent: 'mech_assembly' },
            { id: 'mech_assembly_2', parent: 'mech_assembly' }, { id: 'prog_plc_offline', parent: 'program' },
            { id: 'prog_plc', parent: 'program' }, { id: 'prog_robot', parent: 'program' },
            { id: 'prog_labview', parent: 'program' }, { id: 'inhouse_1', parent: 'inhouse' },
            { id: 'inhouse_2', parent: 'inhouse' }, { id: 'mq1_fat_1', parent: 'mq1_fat' },
            { id: 'mq1_fat_2', parent: 'mq1_fat' }, { id: 'mq1_fat_3', parent: 'mq1_fat' },
            { id: 'dispatch_1', parent: 'dispatch_parent' }, { id: 'dispatch_2', parent: 'dispatch_parent' },
            { id: 'inc_1', parent: 'inc_parent' }, { id: 'inc_2', parent: 'inc_parent' },
            { id: 'inc_3', parent: 'inc_parent' }, { id: 'inc_4', parent: 'inc_parent' }
        ];

        const parentIds = ['kickoff', 'design', 'purchase', 'mech_assembly', 'program', 'inhouse', 'mq1_fat', 'dispatch_parent', 'inc_parent'];

        function getTimelineType(project, parentId) {
            const parentData = project.detailed_phases[parentId] || {};
            if (parentData.timeline_type) {
                return parentData.timeline_type;
            }
            if (parentId === 'purchase' || parentId === 'program') {
                return 'parallel';
            }
            return 'sequential';
        }

        function checkOverlap(items) {
            for (let i = 0; i < items.length; i++) {
                for (let j = i + 1; j < items.length; j++) {
                    const item1 = items[i];
                    const item2 = items[j];
                    if (item1.start && item1.end && item2.start && item2.end) {
                        const s1 = parseDate(item1.start);
                        const e1 = parseDate(item1.end);
                        const s2 = parseDate(item2.start);
                        const e2 = parseDate(item2.end);
                        if (s1 && e1 && s2 && e2) {
                            if (s1 <= e2 && s2 <= e1) {
                                return true;
                            }
                        }
                    }
                }
            }
            return false;
        }

        for (const p of projects) {
            if (!p.detailed_phases) continue;
            let changed = false;

            parentIds.forEach(parentId => {
                const subs = defaultPhases.filter(s => s.parent === parentId);
                const timelineType = getTimelineType(p, parentId);

                const activeSubs = subs.filter(s => {
                    const sData = p.detailed_phases[s.id] || {};
                    return !sData.is_excluded;
                });

                let pStart = null, pEnd = null;
                let rStart = null, rEnd = null;
                let aStart = null, aEnd = null;
                let parentRevisions = [];

                if (activeSubs.length > 0) {
                    // 1. Base Plan CPM
                    const planItems = activeSubs.map(s => {
                        const sData = p.detailed_phases[s.id] || {};
                        let start = parseDate(sData.plan_start);
                        let end = parseDate(sData.plan_end);
                        let duration = 0;
                        if (start && end) {
                            duration = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
                            if (duration < 0) duration = 0;
                        } else if (sData.plan_duration) {
                            duration = parseInt(sData.plan_duration) || 0;
                        }
                        return { start, end, duration };
                    });

                    // Use proper CPM: sum sequential durations, max parallel durations, no gaps
                    const planCpm = calcCpmDuration(planItems);
                    pStart = planCpm.pStart;
                    if (pStart && planCpm.totalDuration > 0) {
                        pEnd = new Date(pStart);
                        pEnd.setDate(pEnd.getDate() + planCpm.totalDuration - 1);
                    }

                    // 2. Reassigned Plan CPM
                    const reassignItems = activeSubs.map(s => {
                        const sData = p.detailed_phases[s.id] || {};
                        let start = null, end = null;
                        if (sData.revisions && sData.revisions.length > 0) {
                            const last = sData.revisions[sData.revisions.length - 1];
                            if (last.start) start = parseDate(last.start);
                            if (last.end) end = parseDate(last.end);
                        } else {
                            if (sData.plan_start) start = parseDate(sData.plan_start);
                            if (sData.plan_end) end = parseDate(sData.plan_end);
                        }
                        let duration = 0;
                        if (start && end) {
                            duration = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
                            if (duration < 0) duration = 0;
                        } else if (sData.plan_duration) {
                            duration = parseInt(sData.plan_duration) || 0;
                        }
                        return { start, end, duration };
                    });

                    // Use proper CPM: sum sequential durations, max parallel durations, no gaps
                    const reassignCpm = calcCpmDuration(reassignItems);
                    rStart = reassignCpm.pStart;
                    if (rStart && reassignCpm.totalDuration > 0) {
                        rEnd = new Date(rStart);
                        rEnd.setDate(rEnd.getDate() + reassignCpm.totalDuration - 1);
                    }

                    // 3. Actuals CPM
                    const actualItems = activeSubs.map(s => {
                        const sData = p.detailed_phases[s.id] || {};
                        let start = parseDate(sData.actual_start);
                        let end = parseDate(sData.actual_end);
                        let duration = 0;
                        if (start && end) {
                            duration = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
                            if (duration < 0) duration = 0;
                        }
                        return { start, end, duration };
                    });

                    // Use proper CPM: sum sequential durations, max parallel durations, no gaps
                    const actualCpm = calcCpmDuration(actualItems);
                    aStart = actualCpm.pStart;
                    const allActCompleted = actualItems.every(item => item.start !== null && item.end !== null);
                    if (allActCompleted && aStart && actualCpm.totalDuration > 0) {
                        aEnd = new Date(aStart);
                        aEnd.setDate(aEnd.getDate() + actualCpm.totalDuration - 1);
                    }

                    // Dynamically calculate revisions history
                    let maxRevs = 0;
                    activeSubs.forEach(s => {
                        const sData = p.detailed_phases[s.id] || {};
                        if (sData.revisions && sData.revisions.length > maxRevs) {
                            maxRevs = sData.revisions.length;
                        }
                    });

                    for (let k = 0; k < maxRevs; k++) {
                        const revItems = activeSubs.map(s => {
                            const sData = p.detailed_phases[s.id] || {};
                            let start = null, end = null;
                            const sRevs = sData.revisions || [];
                            if (sRevs.length > 0) {
                                const revIndex = Math.min(k, sRevs.length - 1);
                                const rev = sRevs[revIndex];
                                if (rev.start) start = parseDate(rev.start);
                                if (rev.end) end = parseDate(rev.end);
                            } else {
                                if (sData.plan_start) start = parseDate(sData.plan_start);
                                if (sData.plan_end) end = parseDate(sData.plan_end);
                            }

                            let duration = 0;
                            if (start && end) {
                                duration = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
                                if (duration < 0) duration = 0;
                            } else if (sData.plan_duration) {
                                duration = parseInt(sData.plan_duration) || 0;
                            }
                            return { start, end, duration };
                        });

                        // Use proper CPM: sum sequential durations, max parallel durations, no gaps
                        const revCpm = calcCpmDuration(revItems);
                        let rKStart = revCpm.pStart;
                        let rKEnd = null;
                        if (rKStart && revCpm.totalDuration > 0) {
                            rKEnd = new Date(rKStart);
                            rKEnd.setDate(rKEnd.getDate() + revCpm.totalDuration - 1);
                        }

                        parentRevisions.push({
                            label: 'R' + (k + 1),
                            start: rKStart ? formatDateLocalISO(rKStart) : '',
                            end: rKEnd ? formatDateLocalISO(rKEnd) : ''
                        });
                    }
                }

                if (!p.detailed_phases[parentId]) p.detailed_phases[parentId] = {};
                const dParent = p.detailed_phases[parentId];

                const computedPlanStart = pStart ? formatDateLocalISO(pStart) : '';
                const computedPlanEnd = pEnd ? formatDateLocalISO(pEnd) : '';
                const nActualStart = aStart ? formatDateLocalISO(aStart) : '';
                const nActualEnd = aEnd ? formatDateLocalISO(aEnd) : '';
                const nReassignStart = rStart ? formatDateLocalISO(rStart) : '';
                const nReassignEnd = rEnd ? formatDateLocalISO(rEnd) : '';

                // JSON compare helper for revisions list comparison
                const areRevisionsEqual = (a1, a2) => JSON.stringify(a1 || []) === JSON.stringify(a2 || []);

                if (dParent.plan_start !== computedPlanStart ||
                    dParent.plan_end !== computedPlanEnd ||
                    dParent.actual_start !== nActualStart ||
                    dParent.actual_end !== nActualEnd ||
                    dParent.reassign_start !== nReassignStart ||
                    dParent.reassign_end !== nReassignEnd ||
                    !areRevisionsEqual(dParent.revisions, parentRevisions)) {
                    
                    dParent.plan_start = computedPlanStart;
                    dParent.plan_end = computedPlanEnd;
                    dParent.actual_start = nActualStart;
                    dParent.actual_end = nActualEnd;
                    dParent.reassign_start = nReassignStart;
                    dParent.reassign_end = nReassignEnd;
                    dParent.revisions = parentRevisions;
                    changed = true;
                }
            });

            const kickoffData = p.detailed_phases['kickoff'] || {};
            const nStartDate = kickoffData.reassign_start || kickoffData.plan_start || '';
            const nReassignStart = (kickoffData.reassign_start && kickoffData.reassign_start !== kickoffData.plan_start) ? kickoffData.reassign_start : '';

            const dispatchData = p.detailed_phases['dispatch_parent'] || {};
            const nDispatchDate = dispatchData.reassign_end || dispatchData.plan_end || '';
            const nReassignDispatch = (dispatchData.reassign_end && dispatchData.reassign_end !== dispatchData.plan_end) ? dispatchData.reassign_end : '';

            const incData = p.detailed_phases['inc_parent'] || {};
            const nMq2Date = incData.reassign_end || incData.plan_end || '';
            const nReassignMq2 = (incData.reassign_end && incData.reassign_end !== incData.plan_end) ? incData.reassign_end : '';

            if (p.start_date !== nStartDate ||
                p.reassign_start_date !== nReassignStart ||
                p.dispatch_date !== nDispatchDate ||
                p.reassign_dispatch_date !== nReassignDispatch ||
                p.mq2_date !== nMq2Date ||
                p.reassign_mq2_date !== nReassignMq2) {
                
                p.start_date = nStartDate;
                p.reassign_start_date = nReassignStart;
                p.dispatch_date = nDispatchDate;
                p.reassign_dispatch_date = nReassignDispatch;
                p.mq2_date = nMq2Date;
                p.reassign_mq2_date = nReassignMq2;
                changed = true;
            }

            if (changed) {
                p.markModified('detailed_phases');
                await p.save();
                projFixed++;
            }
        }
        console.log(`✅ Project Timeline Dates Sanitized. ${projFixed} projects corrected.`);
    } catch (err) {
        console.error('❌ Data Sync Error:', err);
    }
}

async function runReminderCheck() {
    console.log('⏰ Running Automated Reminder Check [%s]...', new Date().toLocaleString());
    try {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr24 = formatDateLocalISO(tomorrow);

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStrYesterday = formatDateLocalISO(yesterday);

        // 1. Check for 24-hour reminders FIRST
        const upcoming24 = await ActionPoint.find({ 
            targetDate: { $gte: dateStrYesterday, $lte: dateStr24 }, 
            statusValue: { $ne: 'Completed' }, 
            reminder24Sent: { $ne: true } 
        });

        console.log(`🔍 Found ${upcoming24.length} tasks for 24h reminder check`);
        for (const task of upcoming24) {
            await sendAutoReminder(task, '24 hours');
            task.reminder24Sent = true;
            task.reminderSent = true; 
            await task.save();
        }

        // 2. Check for 48-hour reminders
        const dayAfterTomorrow = new Date(now);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
        const dateStr48 = formatDateLocalISO(dayAfterTomorrow);

        const upcoming48 = await ActionPoint.find({ 
            targetDate: { $gte: dateStrYesterday, $lte: dateStr48 }, 
            statusValue: { $ne: 'Completed' }, 
            reminderSent: { $ne: true } 
        });
        
        console.log(`🔍 Found ${upcoming48.length} tasks for 48h reminder check`);
        for (const task of upcoming48) {
            await sendAutoReminder(task, '48 hours');
            task.reminderSent = true;
            await task.save();
        }
        console.log('✅ Scheduled Reminder check completed.');
    } catch (err) { 
        console.error('❌ Reminder Check Error:', err); 
    }
}



// PMIS_ALL_PO_ASSOCIATED_EDIT_GUARD_V24
// Authenticated users may read all projects and PO values. Admin can write all
// projects. PM/Coordinator logins can write only projects assigned to them.
const PMIS_AUTH_SECRET = String(
    process.env.PMIS_AUTH_SECRET ||
    process.env.PMIS_ADMIN_PASSWORD ||
    process.env.MONGODB_URI ||
    'pmis-local-development-secret-change-me'
);

function pmisBase64UrlV24(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function pmisDecodeBase64UrlV24(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
    return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function issuePmisAccessTokenV24(user) {
    const payload = {
        role: String(user.role || 'pm'),
        authRole: String(user.authRole || ''),
        username: String(user.username || ''),
        employeeId: String(user.employeeId || ''),
        displayName: String(user.displayName || ''),
        exp: Date.now() + (12 * 60 * 60 * 1000)
    };
    const encoded = pmisBase64UrlV24(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', PMIS_AUTH_SECRET)
        .update(encoded)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return encoded + '.' + signature;
}

function verifyPmisAccessTokenV24(token) {
    try {
        const [encoded, signature] = String(token || '').split('.');
        if (!encoded || !signature) return null;
        const expected = crypto.createHmac('sha256', PMIS_AUTH_SECRET)
            .update(encoded)
            .digest('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
        const actualBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        if (actualBuffer.length !== expectedBuffer.length ||
            !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
        const payload = JSON.parse(pmisDecodeBase64UrlV24(encoded));
        if (!payload.exp || Number(payload.exp) < Date.now()) return null;
        return payload;
    } catch (error) {
        return null;
    }
}

function pmisRequestUserV24(req) {
    const auth = String(req.headers.authorization || '');
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? verifyPmisAccessTokenV24(match[1]) : null;
}

// PMIS_LEAD_VIEW_V51E
const PMIS_LEAD_VIEW_USERNAMES_V51E = new Set(
    String(
        process.env.PMIS_LEAD_VIEW_USERNAMES ||
        'projects@danprel,project@danprel'
    )
        .split(',')
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
);

function pmisIsLeadViewUsernameV51E(value) {
    return PMIS_LEAD_VIEW_USERNAMES_V51E.has(
        String(value || '').trim().toLowerCase()
    );
}

function pmisIsLeadViewUserV51E(user) {
    if (!user) return false;

    if (
        String(user.authRole || '').trim().toLowerCase() === 'lead_view'
    ) {
        return true;
    }

    return pmisIsLeadViewUsernameV51E(user.username);
}

/*
 * Shared Lead View is a viewing account only.
 *
 * GET remains available so Leads can inspect:
 *   - all projects
 *   - project plans / allocations
 *   - calendar / visualization data
 *
 * Every authenticated mutation is denied:
 *   POST / PUT / PATCH / DELETE
 *
 * Auth endpoints are exempt so login / forgot-password remain functional.
 */
app.use('/api', (req, res, next) => {
    const requestPath = String(req.path || '');

    if (requestPath.startsWith('/auth/')) {
        return next();
    }

    const method = String(req.method || '').toUpperCase();

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return next();
    }

    const user = pmisRequestUserV24(req);

    if (!pmisIsLeadViewUserV51E(user)) {
        return next();
    }

    return res.status(403).json({
        error: 'Lead View is read-only. Changes are not permitted.'
    });
});
function pmisNormalizeIdentityV24(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function pmisProjectAssociatedV24(project, user) {
    if (!project || !user) return false;
    if (String(user.role || '').toLowerCase() === 'admin') return true;

    const employeeId = pmisNormalizeIdentityV24(user.employeeId || user.username);
    const displayName = pmisNormalizeIdentityV24(user.displayName);
    const storedEmployeeId = pmisNormalizeIdentityV24(
        project.project_expeditor_employee_id ||
        project.project_manager_employee_id || ''
    );
    if (employeeId && storedEmployeeId && employeeId === storedEmployeeId) return true;

    return String(project.project_manager || '')
        .split(/\s*(?:,|;|\/|\||&|\band\b)\s*/i)
        .map(pmisNormalizeIdentityV24)
        .filter(Boolean)
        .some(person =>
            (employeeId && person === employeeId) ||
            (displayName && person === displayName) ||
            (displayName && person.length >= 5 && displayName.length >= 5 &&
                (person.includes(displayName) || displayName.includes(person)))
        );
}

function pmisUnauthorizedV24(res, status, message) {
    return res.status(status).json({ error: message });
}

// Add the signed token to successful login responses without changing the
// existing credential-validation route.
app.use('/api/auth/login', (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = body => {
        if (body && body.success && !body.accessToken) {
            body.accessToken = issuePmisAccessTokenV24(body);
        }
        return originalJson(body);
    };
    next();
});

async function pmisAuthorizeProjectWriteV24(req, res, next) {
    const method = String(req.method || '').toUpperCase();
    if (!['POST','PUT','PATCH','DELETE'].includes(method)) return next();

    const user = pmisRequestUserV24(req);
    if (!user) return pmisUnauthorizedV24(res, 401, 'Please sign in again before making changes.');
    if (String(user.role || '').toLowerCase() === 'admin') {
        req.pmisUser = user;
        return next();
    }

    const segments = String(req.path || '').split('/').filter(Boolean);
    const projectId = String(req.body?._id || segments[0] || '').trim();

    // Individual logins cannot create a brand-new project because it is not yet
    // assigned. Admin creates and assigns projects.
    if (method === 'POST' && !projectId) {
        return pmisUnauthorizedV24(res, 403, 'Only Admin can create a new project.');
    }
    if (!projectId) return pmisUnauthorizedV24(res, 400, 'Project ID is required.');

    try {
        const project = await Project.findById(projectId);
        if (!project) return pmisUnauthorizedV24(res, 404, 'Project not found.');
        if (!pmisProjectAssociatedV24(project, user)) {
            return pmisUnauthorizedV24(res, 403, 'View only: this project is assigned to another Project Expeditor.');
        }

        // Project assignment can be changed only by Admin. This prevents a user
        // from taking ownership of another project or reassigning their project.
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'project_manager')) {
            const incoming = pmisNormalizeIdentityV24(req.body.project_manager);
            const existing = pmisNormalizeIdentityV24(project.project_manager);
            if (incoming !== existing) {
                return pmisUnauthorizedV24(res, 403, 'Only Admin can change the Project Expeditor assignment.');
            }
        }

        req.pmisUser = user;
        req.pmisProject = project;
        return next();
    } catch (error) {
        return pmisUnauthorizedV24(res, 500, error.message || 'Unable to verify project access.');
    }
}

async function pmisAuthorizeActionPointWriteV24(req, res, next) {
    const method = String(req.method || '').toUpperCase();
    if (!['POST','PUT','PATCH','DELETE'].includes(method)) return next();

    const user = pmisRequestUserV24(req);
    if (!user) return pmisUnauthorizedV24(res, 401, 'Please sign in again before making changes.');
    if (String(user.role || '').toLowerCase() === 'admin') {
        req.pmisUser = user;
        return next();
    }

    try {
        let projectId = String(req.body?.projectId || '').trim();
        if (!projectId) {
            const actionPointId = String(req.path || '').split('/').filter(Boolean)[0] || '';
            const actionPoint = actionPointId ? await ActionPoint.findById(actionPointId) : null;
            projectId = String(actionPoint?.projectId || '').trim();
        }
        if (!projectId) return pmisUnauthorizedV24(res, 400, 'Action point project ID is required.');

        const project = await Project.findById(projectId);
        if (!project) return pmisUnauthorizedV24(res, 404, 'Project not found.');
        if (!pmisProjectAssociatedV24(project, user)) {
            return pmisUnauthorizedV24(res, 403, 'View only: action points can be changed only for your assigned project.');
        }

        req.pmisUser = user;
        req.pmisProject = project;
        return next();
    } catch (error) {
        return pmisUnauthorizedV24(res, 500, error.message || 'Unable to verify action-point access.');
    }
}

app.use('/api/projects', pmisAuthorizeProjectWriteV24);
app.use('/api/action-points', pmisAuthorizeActionPointWriteV24);

// --- API ENDPOINTS ---

// 1. Get All Projects
app.get('/api/projects', async (req, res) => {
    try {
        // PMIS_PRODUCTION_LOADING_OPTIMIZATION_V55E
        await ensureMongoConnected();
        const projects = await Project.find()
            .sort({ createdAt: -1 })
            .lean();
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Get Single Project
app.get('/api/projects/:id', async (req, res) => {
    try {
        // PMIS_PRODUCTION_LOADING_OPTIMIZATION_V55E
        await ensureMongoConnected();
        const p = await Project.findById(req.params.id).lean();
        if (!p) return res.status(404).json({ message: 'Project not found' });
        res.json(p);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Create or Update Project
app.post('/api/projects', async (req, res) => {
    console.log('📡 [POST] /api/projects - Payload:', req.body);
    try {
        const data = req.body;
        
        // Clean po_value if it's an empty string to avoid Mongoose Cast To Number errors
        if (data.po_value === '') {
            data.po_value = null;
        } else if (data.po_value !== undefined && data.po_value !== null) {
            data.po_value = parseFloat(String(data.po_value || "0").replace(/,/g, '')) || 0;
        }
        
        let p;
        if (data._id) {
            p = await Project.findByIdAndUpdate(data._id, data, { new: true, runValidators: true });
        } else {
            p = new Project(data);
            await p.save();
        }
        res.json(p);
    } catch (err) {
        console.error('❌ [POST] /api/projects Error:', err.message);
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

// PMIS_REPORT_LAYOUT_FEEDBACK_NA_V19: Customer-feedback requirement workflow
// PMIS_REPORT_NA_PDF_FIX_V20: exact Required/N/A route is permitted in local safe mode
app.patch('/api/projects/:id/customer-feedback-requirement', async (req, res) => {
    try {
        const requirement = String(req.body?.requirement || '').trim().toLowerCase();
        if (!['required', 'not_required'].includes(requirement)) {
            return res.status(400).json({
                error: 'Requirement must be required or not_required.'
            });
        }

        const project = await Project.findById(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found.' });

        const role = String(req.get('x-pmis-role') || '').trim().toLowerCase();
        const displayName = String(req.get('x-pmis-display-name') || '').trim();
        const employeeId = String(req.get('x-pmis-employee-id') || '').trim();
        const username = String(req.get('x-pmis-username') || '').trim();
        const normalizeIdentity = value =>
            String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

        const assignment = normalizeIdentity(project.project_manager);
        const identities = [displayName, employeeId, username]
            .map(normalizeIdentity)
            .filter(Boolean);
        const isAssociated = Boolean(assignment) && identities.some(identity =>
            assignment.includes(identity) || identity.includes(assignment)
        );

        if (role !== 'admin' && !isAssociated) {
            return res.status(403).json({
                error: 'You can update feedback requirement only for an associated project.'
            });
        }

        project.customer_feedback_requirement = requirement;
        project.customer_feedback_requirement_updated_at = new Date();
        project.customer_feedback_requirement_updated_by =
            displayName || employeeId || username || 'PMIS User';
        await project.save();

        res.json({
            message: requirement === 'not_required'
                ? 'Customer feedback marked as not required.'
                : 'Customer feedback marked as required.',
            project
        });
    } catch (err) {
        console.error('[CUSTOMER FEEDBACK REQUIREMENT]', err.message);
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
        // PMIS_PRODUCTION_LOADING_OPTIMIZATION_V55E
        await ensureMongoConnected();
        const items = await ActionPoint.find(
            projectId ? { projectId } : {}
        )
            .sort({ createdAt: -1 })
            .lean();
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
        const updateData = { ...req.body };
        
        // If the target date is being updated (rescheduled), reset reminder flags
        if (updateData.targetDate) {
            updateData.reminderSent = false;
            updateData.reminder24Sent = false;
        }

        const ap = await ActionPoint.findByIdAndUpdate(req.params.id, updateData, { new: true });
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
        // PMIS_PRODUCTION_LOADING_OPTIMIZATION_V55E
        await ensureMongoConnected();
        const employees = await Employee.find()
            .select('-passwordHash')
            .sort({ createdAt: -1 })
            .lean();
        res.json(employees);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Create or Update Employee
app.post('/api/employees', async (req, res) => {
    console.log(`📥 [POST] /api/employees - Incoming Data:`, req.body);
    try {
        const data = { ...req.body };

        // Authentication fields are managed only through controlled auth/migration routes.
        delete data.passwordHash;
        delete data.username;
        delete data.authRole;
        delete data.loginEnabled;

        let emp;
        if (data._id) {
            const updateId = data._id;
            const updateData = { ...data };
            delete updateData._id; // Ensure we don't try to update the immutable _id field

            emp = await Employee.findByIdAndUpdate(
                updateId,
                updateData,
                { new: true }
            ).select('-passwordHash');
            console.log("✅ Updated Employee:", emp);
        } else {
            emp = new Employee(data);
            await emp.save();
            emp = await Employee.findById(emp._id).select('-passwordHash');
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

// --- AUTHENTICATION API ---
const PMIS_ADMIN_USERNAME =
    String(process.env.PMIS_ADMIN_USERNAME || 'review@danprel').trim();
const PMIS_ADMIN_PASSWORD =
    String(process.env.PMIS_ADMIN_PASSWORD || 'mgt@2026');

function normalizeUsername(value) {
    return String(value || '').trim().toUpperCase();
}

function employeeRoleToAuthRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized.includes('coordinator')) return 'project_coordinator';
    if (normalized.includes('manager')) return 'project_manager';
    return null;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.post('/api/auth/login', async (req, res) => {
    try {
        const usernameInput = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');

        if (!usernameInput || !password) {
            return res.status(400).json({
                error: 'Username and password are required.'
            });
        }

        if (
            safeEqualText(usernameInput.toLowerCase(), PMIS_ADMIN_USERNAME.toLowerCase()) &&
            safeEqualText(password, PMIS_ADMIN_PASSWORD)
        ) {
            return res.json({
                success: true,
                role: 'admin',
                designation: 'Project Management Admin',
                username: PMIS_ADMIN_USERNAME,
                displayName: 'Project Management Admin'
            });
        }

        try {
            await ensureMongoConnected();
        } catch (dbError) {
            console.error('[AUTH] Database connection unavailable:', dbError.message);
            return res.status(503).json({
                error: 'Database connection is unavailable.'
            });
        }

        const normalizedUsername = normalizeUsername(usernameInput);
        const employee = await Employee.findOne({
            $or: [
                { username: normalizedUsername },
                {
                    employee_id: {
                        $regex: `^${escapeRegex(normalizedUsername)}$`,
                        $options: 'i'
                    }
                }
            ]
        }).select('+passwordHash');

        if (
            !employee ||
            !employee.loginEnabled ||
            !employee.passwordHash ||
            !verifyPassword(password, employee.passwordHash)
        ) {
            return res.status(401).json({
                error: 'Invalid username or password.'
            });
        }

        const isLeadViewLoginV51E =
            pmisIsLeadViewUsernameV51E(usernameInput) ||
            pmisIsLeadViewUsernameV51E(employee.username);

        const authRole = isLeadViewLoginV51E
            ? 'lead_view'
            : (employee.authRole || employeeRoleToAuthRole(employee.role));

        if (!authRole) {
            return res.status(403).json({
                error: 'This employee is not authorized for PMIS login.'
            });
        }

        return res.json({
            success: true,
            role: 'pm',
            authRole,
            designation: isLeadViewLoginV51E ? 'Lead View - Read Only' : (employee.role || ''),
            username: employee.username || employee.employee_id,
            employeeId: employee.employee_id,
            displayName: employee.name
        });
    } catch (err) {
        console.error('[AUTH] Login error:', err.message);
        return res.status(500).json({
            error: 'Unable to complete login.'
        });
    }
});

// --- EMAIL API ENDPOINT ---
// --- FORGOT PASSWORD API ---
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim();
        if (!username) {
            return res.status(400).json({ error: 'Username is required.' });
        }

        const isAdmin =
            username.toLowerCase() === PMIS_ADMIN_USERNAME.toLowerCase();

        let employee = null;
        if (!isAdmin) {
            const normalizedUsername = normalizeUsername(username);
            employee = await Employee.findOne({
                $or: [
                    { username: normalizedUsername },
                    {
                        employee_id: {
                            $regex: `^${escapeRegex(normalizedUsername)}$`,
                            $options: 'i'
                        }
                    }
                ],
                loginEnabled: true
            });
        }

        if (!isAdmin && !employee) {
            return res.status(404).json({ error: 'Username not found in PMIS.' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const key = normalizeUsername(username);
        resetCodes.set(key, {
            code,
            verified: false,
            expiresAt: Date.now() + (10 * 60 * 1000)
        });

        const mailOptions = {
            from: `Auth System <${process.env.SMTP_USER}>`,
            to: process.env.PMIS_RESET_EMAIL || 'danprelpmis@gmail.com',
            subject: `PMIS Password Reset - ${username}`,
            html: `<h3>PMIS Password Reset</h3><p>User <b>${username}</b> requested a password reset.</p><p>Verification Code: <b style="font-size:20px">${code}</b></p><p>This code expires in 10 minutes.</p>`
        };

        await transporter.sendMail(mailOptions);
        return res.json({ message: 'Verification code sent to management.' });
    } catch (err) {
        console.error('[AUTH] Forgot password error:', err.message);
        return res.status(500).json({ error: 'Unable to send reset code.' });
    }
});

app.post('/api/auth/verify-code', (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const code = String(req.body?.code || '').trim();
    const reset = resetCodes.get(username);

    if (!reset || reset.expiresAt < Date.now()) {
        resetCodes.delete(username);
        return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    if (!safeEqualText(code, reset.code)) {
        return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    reset.verified = true;
    resetCodes.set(username, reset);
    return res.json({ success: true });
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const username = normalizeUsername(req.body?.username);
        const code = String(req.body?.code || '').trim();
        const newPassword = String(req.body?.newPassword || '');
        const reset = resetCodes.get(username);

        if (newPassword.length < 8) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters.'
            });
        }

        if (
            !reset ||
            reset.expiresAt < Date.now() ||
            !reset.verified ||
            !safeEqualText(code, reset.code)
        ) {
            return res.status(400).json({ error: 'Reset authorization expired.' });
        }

        if (username === normalizeUsername(PMIS_ADMIN_USERNAME)) {
            return res.status(400).json({
                error: 'The admin password must be changed in Netlify environment variables.'
            });
        }

        const employee = await Employee.findOne({
            $or: [
                { username },
                {
                    employee_id: {
                        $regex: `^${escapeRegex(username)}$`,
                        $options: 'i'
                    }
                }
            ],
            loginEnabled: true
        }).select('+passwordHash');

        if (!employee) {
            return res.status(404).json({ error: 'PMIS user not found.' });
        }

        employee.passwordHash = hashPassword(newPassword);
        employee.username = normalizeUsername(employee.username || employee.employee_id);
        await employee.save();
        resetCodes.delete(username);

        return res.json({ success: true, message: 'Password updated.' });
    } catch (err) {
        console.error('[AUTH] Reset password error:', err.message);
        return res.status(500).json({ error: 'Unable to reset password.' });
    }
});

app.post('/api/send-email', async (req, res) => {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
        return res.status(400).json({ error: 'Missing to, subject, or body' });
    }

    const mailOptions = {
        from: `Danprel <${process.env.SMTP_USER}>`, // Updated display name
        to,
        subject,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
                .wrapper { width: 100%; background-color: #ffffff; padding: 40px 0; }
                .container { max-width: 600px; margin: 0 auto; padding: 0 20px; }
                
                /* Header Styling */
                .header { border-bottom: 2px solid #f8fafc; padding-bottom: 25px; margin-bottom: 35px; }
                .logo { width: 48px; height: auto; margin-bottom: 12px; }
                .company-name { font-size: 14px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 1.5px; margin: 0; }
                .company-sub { font-size: 11px; color: #14b8a6; font-weight: 600; margin-top: 4px; }
                
                /* Content Styling */
                .content { font-size: 16px; line-height: 1.6; color: #334155; }
                .content p { margin-bottom: 20px; }
                
                /* Footer Styling */
                .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: left; }
                .footer-text { font-size: 12px; color: #94a3b8; line-height: 1.5; }
            </style>
        </head>
        <body>
            <div class="wrapper">
                <div class="container">
                    
                    <div class="header">
                        <img src="https://danprelpmis.netlify.app/asset/image.png" alt="Danprel" class="logo">
                        <h1 class="company-name">Danprel Engineering Automation Pvt Ltd</h1>
                    </div>

                    <div class="content">
                        ${body}
                    </div>

                    <div class="footer">
                        <p class="footer-text">
                            <strong>Danprel Engineering Automation Pvt Ltd</strong><br>
                            This is an automated system message. Please do not reply directly to this email.<br>
                            &copy; 2026 All rights reserved.
                        </p>
                    </div>

                </div>
            </div>
        </body>
        </html>
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

// 12. Feedback workflow
function getPmisRoleHeader(req) {
    return String(req.get('x-pmis-role') || '').trim().toLowerCase();
}

function requirePmisAdmin(req, res, next) {
    if (getPmisRoleHeader(req) !== 'admin') {
        return res.status(403).json({ error: 'Admin access is required.' });
    }
    next();
}

async function resolveFeedbackSubmitter(req) {
    const employeeId = String(
        req.get('x-pmis-employee-id') || req.body?.employeeId || ''
    ).trim();
    const username = String(
        req.get('x-pmis-username') || req.body?.username || ''
    ).trim();
    const displayName = String(
        req.get('x-pmis-display-name') || req.body?.displayName || ''
    ).trim();

    let employee = null;
    if (mongoose.connection.readyState === 1 && (employeeId || username)) {
        const matchers = [];
        if (employeeId) {
            matchers.push({
                employee_id: {
                    $regex: '^' + escapeRegex(employeeId) + '$',
                    $options: 'i'
                }
            });
        }
        if (username) matchers.push({ username: normalizeUsername(username) });
        employee = await Employee.findOne({ $or: matchers }).lean();
    }

    return {
        submittedByName: employee?.name || displayName || username || 'PMIS User',
        submittedByEmail: employee?.email || '',
        submittedByEmployeeId: employee?.employee_id || employeeId,
        submittedByUsername: employee?.username || username
    };
}

app.post('/api/feedback', async (req, res) => {
    try {
        const content = String(req.body?.content || '').trim();
        const sourcePage = String(req.body?.sourcePage || 'Unknown').trim();
        if (!content) {
            return res.status(400).json({ message: 'Feedback content is empty' });
        }

        const submitter = await resolveFeedbackSubmitter(req);
        const feedback = new Feedback({
            content,
            sourcePage,
            status: 'open',
            ...submitter,
            statusHistory: [{
                status: 'open',
                note: 'Feedback submitted',
                changedBy: submitter.submittedByName || 'PMIS User',
                changedAt: new Date(),
                emailNotified: false
            }]
        });
        await feedback.save();
        res.json({ message: 'Feedback saved successfully', id: feedback._id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/feedback/mine', async (req, res) => {
    try {
        const employeeId = String(req.get('x-pmis-employee-id') || '').trim();
        const username = normalizeUsername(req.get('x-pmis-username') || '');

        if (!employeeId && !username) {
            return res.status(401).json({ error: 'Login identity is required.' });
        }

        let employee = null;
        if (employeeId || username) {
            employee = await Employee.findOne({
                $or: [
                    ...(employeeId ? [{ employee_id: { $regex: `^${escapeRegex(employeeId)}$`, $options: 'i' } }] : []),
                    ...(username ? [{ username }, { employee_id: { $regex: `^${escapeRegex(username)}$`, $options: 'i' } }] : [])
                ]
            }).lean();
        }

        const identities = [];
        if (employee?.employee_id || employeeId) identities.push({ submittedByEmployeeId: employee?.employee_id || employeeId });
        if (employee?.username || username) identities.push({ submittedByUsername: employee?.username || username });
        if (employee?.email) identities.push({ submittedByEmail: employee.email });

        if (!identities.length) {
            return res.json([]);
        }

        const feedbacks = await Feedback.find({ $or: identities })
            .sort({ createdAt: -1 })
            .lean();

        res.json(feedbacks.map(item => ({
            ...item,
            status: item.status || 'open',
            adminNote: item.adminNote || ''
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/feedback/admin', requirePmisAdmin, async (req, res) => {
    try {
        const feedbacks = await Feedback.find({}).sort({ createdAt: -1 }).lean();
        const normalized = feedbacks.map(item => ({
            ...item,
            status: item.status || 'open',
            submittedByName: item.submittedByName || 'Legacy feedback',
            submittedByEmail: item.submittedByEmail || '',
            submittedByEmployeeId: item.submittedByEmployeeId || '',
            adminNote: item.adminNote || ''
        }));
        res.json(normalized);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/feedback/:id/status', requirePmisAdmin, async (req, res) => {
    try {
        const status = String(req.body?.status || '').trim().toLowerCase();
        const adminNote = String(req.body?.adminNote || '').trim();
        const changedBy = String(
            req.get('x-pmis-display-name') || req.get('x-pmis-username') || 'PMIS Admin'
        ).trim();

        if (!['open', 'wip', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Status must be open, wip, or closed.' });
        }

        const feedback = await Feedback.findById(req.params.id);
        if (!feedback) return res.status(404).json({ error: 'Feedback not found.' });

        let emailNotified = false;
        let notificationMessage = 'No submitter email is available for this feedback.';
        const statusLabel = status === 'wip'
            ? 'WIP'
            : status.charAt(0).toUpperCase() + status.slice(1);

        if (feedback.submittedByEmail && !LOCAL_SAFE_MODE) {
            try {
                const safeContent = String(feedback.content || '')
                    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const safeNote = adminNote
                    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const html =
                    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b">' +
                    '<h2 style="color:#003366">PMIS Feedback Update</h2>' +
                    '<p>Hello ' + (feedback.submittedByName || 'Team Member') + ',</p>' +
                    '<p>Your feedback submitted from <strong>' + (feedback.sourcePage || 'PMIS') +
                    '</strong> is now marked as <strong>' + statusLabel + '</strong>.</p>' +
                    '<p><strong>Your feedback:</strong><br>' + safeContent + '</p>' +
                    (safeNote ? '<p><strong>Admin note:</strong><br>' + safeNote + '</p>' : '') +
                    '<p>Regards,<br>Danprel PMIS Admin</p></div>';

                await transporter.sendMail({
                    from: process.env.SMTP_USER,
                    to: feedback.submittedByEmail,
                    subject: 'PMIS feedback status updated: ' + statusLabel,
                    html
                });
                emailNotified = true;
                notificationMessage = 'The submitter was notified by email.';
            } catch (mailError) {
                console.error('[FEEDBACK] Status notification failed:', mailError.message);
                notificationMessage = 'Status updated, but the email notification failed.';
            }
        } else if (feedback.submittedByEmail && LOCAL_SAFE_MODE) {
            notificationMessage = 'Status updated. Email was skipped in local safe mode.';
        }

        feedback.status = status;
        feedback.adminNote = adminNote;
        feedback.statusUpdatedAt = new Date();
        feedback.statusUpdatedBy = changedBy;
        feedback.statusHistory = feedback.statusHistory || [];
        feedback.statusHistory.push({
            status,
            note: adminNote,
            changedBy,
            changedAt: new Date(),
            emailNotified
        });
        await feedback.save();

        res.json({
            message: 'Feedback status updated.',
            notificationMessage,
            emailNotified,
            feedback
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 13. Netlify Cron Trigger (Public endpoint for external schedulers)
app.get('/api/cron/reminders', async (req, res) => {
    console.log('🌐 Remote Cron Trigger received...');
    try {
        // Run sync first to ensure dates are correct
        await syncDataOnStartup();
        // Then run the reminder check
        await runReminderCheck();
        res.json({ message: 'Sync and Reminder check completed successfully.' });
    } catch (err) {
        console.error('❌ Remote Cron Error:', err);
        res.status(500).json({ error: 'Cron trigger failed: ' + err.message });
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

if (
    process.env.NODE_ENV !== 'production' ||
    !process.env.NETLIFY
) {
    if (!LOCAL_SAFE_MODE) {
        cron.schedule(
            '0 9-12 * * *',
            runReminderCheck
        );
    } else {
        console.log(
            '[LOCAL SAFE MODE] Reminder cron disabled.'
        );
    }

    app.listen(PORT, () => {
        console.log(
            `Server running at http://localhost:${PORT}/`
        );

        if (!LOCAL_SAFE_MODE) {
            syncDataOnStartup();
        } else {
            console.log(
                '[LOCAL SAFE MODE] Startup sync disabled.'
            );
        }
    });
}

// Export for serverless
module.exports = app;
