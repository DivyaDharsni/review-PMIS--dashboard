const { schedule } = require('@netlify/functions');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

// We need to re-define the logic here because Netlify Functions run in a separate environment
const ActionPointSchema = new mongoose.Schema({
    projectId: String,
    projectCode: String,
    action: String,
    dept: String,
    personName: String,
    email: String,
    reviewDate: String,
    targetDate: String,
    statusValue: String,
    reminderSent: Boolean,
    reminder24Sent: Boolean,
    revisions: [
        {
            date: String,
            remark: String,
            timestamp: String
        }
    ]
}, { timestamps: true });

const ActionPoint = mongoose.models.ActionPoint || mongoose.model('ActionPoint', ActionPointSchema);

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || 465),
    secure: parseInt(process.env.SMTP_PORT || 465) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
});

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
}

const handler = async (event, context) => {
    console.log('⏰ Netlify Scheduled Task Started...');
    
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGODB_URI);
    }

    try {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStrYesterday = yesterday.toISOString().split('T')[0];

        // 1. Sync Data
        const allTasks = await ActionPoint.find({ 'revisions.0': { $exists: true } });
        for (const task of allTasks) {
            const latestRev = [...task.revisions].filter(r => r.date).pop();
            if (latestRev && latestRev.date && latestRev.date !== task.targetDate) {
                task.targetDate = latestRev.date;
                await task.save();
            }
        }

        // 2. Check 24h
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr24 = tomorrow.toISOString().split('T')[0];

        const upcoming24 = await ActionPoint.find({ 
            targetDate: { $gte: dateStrYesterday, $lte: dateStr24 }, 
            statusValue: { $ne: 'Completed' }, 
            reminder24Sent: { $ne: true } 
        });

        for (const task of upcoming24) {
            await sendAutoReminder(task, '24 hours');
            task.reminder24Sent = true;
            task.reminderSent = true;
            await task.save();
        }

        // 3. Check 48h
        const dayAfterTomorrow = new Date(now);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
        const dateStr48 = dayAfterTomorrow.toISOString().split('T')[0];

        const upcoming48 = await ActionPoint.find({ 
            targetDate: { $gte: dateStrYesterday, $lte: dateStr48 }, 
            statusValue: { $ne: 'Completed' }, 
            reminderSent: { $ne: true } 
        });

        for (const task of upcoming48) {
            await sendAutoReminder(task, '48 hours');
            task.reminderSent = true;
            await task.save();
        }

        return { statusCode: 200 };
    } catch (err) {
        console.error('Netlify Cron Error:', err);
        return { statusCode: 500, body: err.message };
    }
};

// Schedule it to run at 9, 10, 11, and 12 daily
module.exports.handler = schedule("0 9,10,11,12 * * *", handler);
