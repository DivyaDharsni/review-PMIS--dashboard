require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('.')); // Serve static HTML files from the current folder

// Middleware to prevent browser caching of dynamic API responses
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log('✅ Connected to MongoDB Atlas'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err.message));
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
transporter.verify((error, success) => {
    if (error) {
        console.error('📧 [SMTP] Connection Error:', error.message);
        if (!process.env.SMTP_USER) console.error('⚠️ [SMTP] SMTP_USER is missing in environment variables!');
    } else {
        console.log('📧 [SMTP] Connected and ready');
    }
});

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
    console.log('📡 [POST] /api/projects - Payload:', req.body);
    try {
        const data = req.body;
        
        // Clean po_value if it's an empty string to avoid Mongoose Cast To Number errors
        if (data.po_value === '') {
            data.po_value = null;
        } else if (data.po_value !== undefined && data.po_value !== null) {
            data.po_value = parseFloat(data.po_value);
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
// --- FORGOT PASSWORD API ---
app.post('/api/auth/forgot-password', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(username, code);

    // Auto-expiry in 10 mins
    setTimeout(() => resetCodes.delete(username), 600000);

    const mailOptions = {
        from: `Auth System <${process.env.SMTP_USER}>`,
        to: 'danprelpmis@gmail.com',
        subject: 'Verification Code for Password Reset',
        html: `<h3>Password Reset Request</h3><p>User <b>${username}</b> requested a password reset.</p><p>Verification Code: <b style="font-size: 20px;">${code}</b></p>`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Forgot Password code sent to admin');
        res.json({ message: 'Code sent to admin email' });
    } catch (err) {
        console.error('❌ Forgot Password Email Failed:', err.message);
        res.status(500).json({ error: 'Failed to send email: ' + err.message });
    }
});

app.post('/api/auth/verify-code', (req, res) => {
    const { username, code } = req.body;
    const validCode = resetCodes.get(username);

    if (validCode && validCode === code) {
        res.json({ success: true });
        resetCodes.delete(username); // One-time use
    } else {
        res.status(400).json({ error: 'Invalid or expired code' });
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

if (process.env.NODE_ENV !== 'production' || !process.env.NETLIFY) {
    // --- AUTOMATED REMINDER CRON JOB (Every hour from 9:00 AM to 12:00 PM) ---
    // Pattern '0 9-12 * * *' triggers at 9:00, 10:00, 11:00, and 12:00
    cron.schedule('0 9-12 * * *', runReminderCheck);

    app.listen(PORT, () => {
        console.log(`\n🚀 Server running at http://localhost:${PORT}/`);
        console.log(`MongoDB storage is now active.\n`);
        
        // ONLY sync data on startup, DO NOT send emails immediately
        syncDataOnStartup();
    });
}

// Export for serverless
module.exports = app;
