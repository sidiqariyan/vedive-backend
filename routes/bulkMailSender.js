const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const crypto = require('crypto');
const cheerio = require('cheerio');
const Campaign = require('../models/Campaign');
const TrackingEvent = require('../models/TrackingEvent');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

const upload = multer({ dest: 'uploads/' });

const ANTI_SPAM_CONFIG = {
  MAX_BATCH_SIZE: 50,
  DELAY_BETWEEN_BATCHES: 2000,
  DELAY_BETWEEN_EMAILS: 100,
  MAX_EMAILS_PER_HOUR: 500,
  SPAM_KEYWORDS: ['free', 'urgent', 'limited time', 'act now', 'click here', 'guaranteed', 'winner', 'cash', 'buy now', 'call now']
};

const containsSpamKeywords = (subject, body) => {
  const text = `${subject} ${body}`.toLowerCase();
  const foundKeywords = ANTI_SPAM_CONFIG.SPAM_KEYWORDS.filter(keyword => text.includes(keyword.toLowerCase()));
  return { hasSpamKeywords: foundKeywords.length > 0, foundKeywords };
};

const getAntiSpamHeaders = (domain, campaignId) => {
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const listId = `<campaign-${campaignId}@${domain}>`;
  return {
    'Message-ID': messageId,
    'List-ID': listId,
    'List-Unsubscribe': `<mailto:unsubscribe-${campaignId}@${domain}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Precedence': 'bulk',
    'X-Mailer': 'Vedive Bulk Mailer v1.0',
    'X-Campaign-ID': campaignId.toString(),
    'MIME-Version': '1.0',
    'Content-Type': 'text/html; charset=UTF-8',
    'X-Priority': '3',
    'X-MSMail-Priority': 'Normal',
    'Return-Path': `bounce-${campaignId}@${domain}`,
    'Errors-To': `bounce-${campaignId}@${domain}`
  };
};

const improveEmailContent = (emailBody, recipientName, domain, campaignId, trackingToken) => {
  let improvedBody = emailBody;
  
  if (recipientName) {
    improvedBody = improvedBody.replace(/\{name\}/gi, recipientName);
    improvedBody = improvedBody.replace(/\{first_name\}/gi, recipientName.split(' ')[0]);
  }
  
  const unsubscribeLink = `<p style="font-size: 12px; color: #666; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px;">
    If you no longer wish to receive these emails, you can 
    <a href="mailto:unsubscribe-${campaignId}@${domain}?subject=Unsubscribe" style="color: #666;">unsubscribe here</a>.
  </p>`;
  
  if (!improvedBody.toLowerCase().includes('unsubscribe')) {
    if (improvedBody.toLowerCase().includes('</body>')) {
      improvedBody = improvedBody.replace('</body>', `${unsubscribeLink}</body>`);
    } else {
      improvedBody += unsubscribeLink;
    }
  }
  
  if (trackingToken) {
    const $ = cheerio.load(improvedBody, { decodeEntities: false, lowerCaseAttributeNames: false });
    
    $('a').each(function() {
      const originalUrl = $(this).attr('href');
      if (originalUrl && originalUrl.startsWith('http')) {
        const trackingUrl = `${process.env.BASE_URL}/api/track/click?token=${trackingToken}&url=${encodeURIComponent(originalUrl)}`;
        $(this).attr('href', trackingUrl);
      }
    });
    
    const trackingPixel = `<img src="${process.env.BASE_URL}/api/track/open?token=${trackingToken}" width="1" height="1" alt="" style="display:none !important; visibility:hidden !important; opacity:0 !important; position:absolute !important; left:-9999px !important;" border="0" />`;
    
    if ($('body').length > 0) {
      $('body').append(trackingPixel);
    } else if ($('html').length > 0) {
      $('html').append(trackingPixel);
    } else {
      improvedBody += trackingPixel;
      return improvedBody;
    }
    
    improvedBody = $.html();
  }
  
  if (!improvedBody.toLowerCase().includes('<html>')) {
    improvedBody = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email</title>
</head>
<body>
    ${improvedBody}
</body>
</html>`;
  }
  
  return improvedBody;
};

const sendEmailsInBatches = async (transporter, emailData, recipients, campaignId) => {
  const results = { sent: 0, failed: 0, errors: [] };
  
  const batches = [];
  for (let i = 0; i < recipients.length; i += ANTI_SPAM_CONFIG.MAX_BATCH_SIZE) {
    batches.push(recipients.slice(i, i + ANTI_SPAM_CONFIG.MAX_BATCH_SIZE));
  }
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    for (const recipient of batch) {
      try {
        let domain = 'localhost';
        try {
          const listIdHeader = emailData.headers['List-ID'];
          if (listIdHeader && listIdHeader.includes('@')) {
            domain = listIdHeader.split('@')[1].replace('>', '');
          }
        } catch (e) {}
        
        const personalizedBody = improveEmailContent(emailData.html, recipient.name, domain, campaignId, recipient.trackingToken);
        
        const mailOptions = {
          from: emailData.from,
          to: recipient.email,
          subject: emailData.subject,
          html: personalizedBody,
          headers: emailData.headers,
          envelope: { from: emailData.envelope.from, to: recipient.email },
          messageId: emailData.messageId,
          date: emailData.date,
          encoding: emailData.encoding
        };
        
        await transporter.sendMail(mailOptions);
        results.sent++;
        
        if (ANTI_SPAM_CONFIG.DELAY_BETWEEN_EMAILS > 0) {
          await new Promise(resolve => setTimeout(resolve, ANTI_SPAM_CONFIG.DELAY_BETWEEN_EMAILS));
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ email: recipient.email, token: recipient.trackingToken, error: error.message });
      }
    }
    
    if (batchIndex < batches.length - 1 && ANTI_SPAM_CONFIG.DELAY_BETWEEN_BATCHES > 0) {
      await new Promise(resolve => setTimeout(resolve, ANTI_SPAM_CONFIG.DELAY_BETWEEN_BATCHES));
    }
  }
  
  return results;
};

const validateFileType = (file, allowedTypes) => {
  const fileExtension = path.extname(file.originalname).toLowerCase();
  return allowedTypes.includes(fileExtension);
};

const readRecipientsFromFile = async (file) => {
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  try {
    if (fileExtension === '.txt') {
      const recipientsData = fs.readFileSync(file.path, 'utf-8');
      const emails = recipientsData.split(/\r?\n/).filter((email) => email.trim() !== '');
      return emails.map(email => ({ email: email.trim(), name: null }));
    } 
    else if (fileExtension === '.csv') {
      return new Promise((resolve, reject) => {
        const recipients = [];
        let hasNameColumn = false;
        
        fs.createReadStream(file.path)
          .pipe(csv())
          .on('headers', (headers) => {
            hasNameColumn = headers.some(header => header.toLowerCase().trim() === 'name');
            if (!hasNameColumn) reject(new Error('CSV file must contain a "name" column'));
          })
          .on('data', (row) => {
            const emailKey = Object.keys(row).find(key => key.toLowerCase().includes('email') || key.toLowerCase().includes('mail'));
            const nameKey = Object.keys(row).find(key => key.toLowerCase().trim() === 'name');
            
            if (emailKey && row[emailKey] && row[emailKey].trim()) {
              recipients.push({ email: row[emailKey].trim(), name: nameKey ? row[nameKey].trim() : null });
            }
          })
          .on('end', () => resolve(recipients))
          .on('error', (error) => reject(error));
      });
    } 
    else if (fileExtension === '.xlsx') {
      const workbook = xlsx.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      
      if (data.length === 0) throw new Error('Excel file is empty');
      
      const headers = Object.keys(data[0]);
      const hasNameColumn = headers.some(header => header.toLowerCase().trim() === 'name');
      if (!hasNameColumn) throw new Error('Excel file must contain a "name" column');
      
      const recipients = [];
      data.forEach(row => {
        const emailKey = Object.keys(row).find(key => key.toLowerCase().includes('email') || key.toLowerCase().includes('mail'));
        const nameKey = Object.keys(row).find(key => key.toLowerCase().trim() === 'name');
        
        if (emailKey && row[emailKey] && String(row[emailKey]).trim()) {
          recipients.push({ email: String(row[emailKey]).trim(), name: nameKey ? String(row[nameKey]).trim() : null });
        }
      });
      
      return recipients;
    }
    else {
      throw new Error('Unsupported file type');
    }
  } catch (error) {
    throw new Error(`Error reading recipients file: ${error.message}`);
  }
};

const calculateCampaignAnalytics = async (campaignId, totalRecipients) => {
  const openEvents = await TrackingEvent.find({ campaignId: campaignId, eventType: 'open' });
  const clickEvents = await TrackingEvent.find({ campaignId: campaignId, eventType: 'click' });
  const uniqueOpens = [...new Set(openEvents.map(event => event.recipientEmail))];
  const uniqueClicks = [...new Set(clickEvents.map(event => event.recipientEmail))];
  const openRate = totalRecipients > 0 ? (uniqueOpens.length / totalRecipients) * 100 : 0;
  const clickRate = totalRecipients > 0 ? (uniqueClicks.length / totalRecipients) * 100 : 0;
  const notOpenRate = 100 - openRate;
  const clickThroughRate = uniqueOpens.length > 0 ? (uniqueClicks.length / uniqueOpens.length) * 100 : 0;

  return {
    totalRecipients,
    uniqueOpens: uniqueOpens.length,
    uniqueClicks: uniqueClicks.length,
    totalOpens: openEvents.length,
    totalClicks: clickEvents.length,
    openRate: parseFloat(openRate.toFixed(2)),
    clickRate: parseFloat(clickRate.toFixed(2)),
    notOpenRate: parseFloat(notOpenRate.toFixed(2)),
    clickThroughRate: parseFloat(clickThroughRate.toFixed(2)),
    notClicked: totalRecipients - uniqueClicks.length,
    notOpened: totalRecipients - uniqueOpens.length
  };
};

// Send bulk mail endpoint
router.post('/send-bulk-mail', authenticate, upload.fields([{ name: 'recipientsFile' }, { name: 'htmlTemplate' }]), async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUsername, smtpPassword, fromEmail, emailSubject, campaignName } = req.body;

    if (!smtpHost || !smtpPort || !smtpUsername || !smtpPassword || !fromEmail || !emailSubject || !campaignName) {
      return res.status(400).json({ error: 'Missing required SMTP, email, or campaign details.' });
    }

    const recipientsFile = req.files?.recipientsFile?.[0];
    const htmlTemplateFile = req.files?.htmlTemplate?.[0];
    if (!recipientsFile || !htmlTemplateFile) {
      return res.status(400).json({ error: 'Recipients file and HTML template file are required.' });
    }

    const allowedRecipientTypes = ['.txt', '.csv', '.xlsx'];
    if (!validateFileType(recipientsFile, allowedRecipientTypes)) {
      return res.status(400).json({ error: 'Invalid recipients file type. Allowed types: .txt, .csv, .xlsx' });
    }

    const allowedTemplateTypes = ['.html', '.htm', '.txt'];
    if (!validateFileType(htmlTemplateFile, allowedTemplateTypes)) {
      return res.status(400).json({ error: 'Invalid HTML template file type. Allowed types: .html, .htm, .txt' });
    }

    const recipientsData = await readRecipientsFromFile(recipientsFile);
    const emailBody = fs.readFileSync(htmlTemplateFile.path, 'utf-8');
    const fromDomain = smtpUsername.split('@')[1] || 'localhost';
    
    const spamCheck = containsSpamKeywords(emailSubject, emailBody);

    const transporter = nodemailer.createTransporter({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: smtpPort == 465,
      auth: { user: smtpUsername, pass: smtpPassword },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
      tls: { rejectUnauthorized: false, ciphers: 'SSLv3' }
    });

    const recipientsWithTokens = recipientsData.map(recipient => ({
      email: recipient.email,
      name: recipient.name,
      trackingToken: crypto.randomBytes(16).toString('hex')
    }));

    const newCampaign = new Campaign({
      userId: req.user._id,
      campaignName,
      toolType: 'mail-sender',
      smtpHost,
      smtpPort: parseInt(smtpPort),
      smtpUsername,
      smtpPassword,
      fromEmail,
      emailSubject,
      recipients: recipientsWithTokens,
      status: 'pending',
    });

    await newCampaign.save();

    const fromField = `"${fromEmail}" <${smtpUsername}>`;
    const antiSpamHeaders = getAntiSpamHeaders(fromDomain, newCampaign._id);
    const validRecipients = newCampaign.recipients.filter(recipient => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email));

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found in recipients file.' });
    }

    if (validRecipients.length > ANTI_SPAM_CONFIG.MAX_EMAILS_PER_HOUR) {
      return res.status(400).json({ 
        error: `Too many recipients. Maximum ${ANTI_SPAM_CONFIG.MAX_EMAILS_PER_HOUR} emails per batch allowed.`,
        recipientCount: validRecipients.length,
        maxAllowed: ANTI_SPAM_CONFIG.MAX_EMAILS_PER_HOUR
      });
    }

    const emailData = {
      from: fromField,
      subject: emailSubject,
      html: emailBody,
      headers: antiSpamHeaders,
      envelope: { from: smtpUsername, to: validRecipients.map(r => r.email) },
      messageId: antiSpamHeaders['Message-ID'],
      date: new Date(),
      encoding: 'utf8'
    };

    const sendResults = await sendEmailsInBatches(transporter, emailData, validRecipients, newCampaign._id);

    newCampaign.status = 'completed';
    await newCampaign.save();

    transporter.close();
    fs.unlinkSync(recipientsFile.path);
    fs.unlinkSync(htmlTemplateFile.path);

    res.json({ 
      message: 'Bulk emails sent successfully!', 
      campaignId: newCampaign._id, 
      success: true,
      totalRecipients: validRecipients.length,
      emailsSent: sendResults.sent,
      emailsFailed: sendResults.failed,
    });
  } catch (error) {
    console.error('Error sending bulk emails:', error);
    res.status(500).json({ error: 'Failed to send bulk emails', details: error.message });
  }
});

// Get campaigns with analytics
router.get('/campaigns', authenticate, async (req, res) => {
  try {
    const { toolType = 'mail-sender' } = req.query;
    const filter = { userId: req.user._id };
    if (toolType) filter.toolType = toolType;
    
    const campaigns = await Campaign.find(filter).select('-smtpPassword').sort({ createdAt: -1 });
    const campaignsWithAnalytics = await Promise.all(campaigns.map(async (campaign) => {
      const analytics = await calculateCampaignAnalytics(campaign._id, campaign.recipients.length);
      return { ...campaign.toObject(), analytics };
    }));

    res.json(campaignsWithAnalytics);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns', details: error.message });
  }
});

// Get detailed analytics for specific campaign
router.get('/campaigns/:campaignId/analytics', authenticate, async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findOne({ _id: campaignId, userId: req.user._id }).select('-smtpPassword');

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const analytics = await calculateCampaignAnalytics(campaign._id, campaign.recipients.length);
    const openEvents = await TrackingEvent.find({ campaignId: campaign._id, eventType: 'open' }).sort({ timestamp: -1 });
    const clickEvents = await TrackingEvent.find({ campaignId: campaign._id, eventType: 'click' }).sort({ timestamp: -1 });

    const recipientStatus = campaign.recipients.map(recipient => {
      const hasOpened = openEvents.some(event => event.recipientEmail === recipient.email);
      const hasClicked = clickEvents.some(event => event.recipientEmail === recipient.email);
      const openCount = openEvents.filter(event => event.recipientEmail === recipient.email).length;
      const clickCount = clickEvents.filter(event => event.recipientEmail === recipient.email).length;

      return {
        email: recipient.email,
        name: recipient.name,
        status: hasClicked ? 'clicked' : hasOpened ? 'opened' : 'not_opened',
        hasOpened,
        hasClicked,
        openCount,
        clickCount,
        lastOpened: hasOpened ? openEvents.find(e => e.recipientEmail === recipient.email)?.timestamp : null,
        lastClicked: hasClicked ? clickEvents.find(e => e.recipientEmail === recipient.email)?.timestamp : null
      };
    });

    const groupedRecipients = {
      opened: recipientStatus.filter(r => r.hasOpened && !r.hasClicked),
      clicked: recipientStatus.filter(r => r.hasClicked),
      not_opened: recipientStatus.filter(r => !r.hasOpened)
    };

    const clickDetails = clickEvents.map(event => ({
      email: event.recipientEmail,
      url: event.details,
      timestamp: event.timestamp
    }));

    res.json({
      campaign: { ...campaign.toObject(), analytics },
      detailedAnalytics: {
        ...analytics,
        recipientStatus,
        groupedRecipients,
        clickDetails,
        recentActivity: { recentOpens: openEvents.slice(0, 10), recentClicks: clickEvents.slice(0, 10) }
      }
    });
  } catch (error) {
    console.error('Error fetching campaign analytics:', error);
    res.status(500).json({ error: 'Failed to fetch campaign analytics', details: error.message });
  }
});

// Get analytics summary
router.get('/analytics/summary', authenticate, async (req, res) => {
  try {
    const { toolType = 'mail-sender' } = req.query;
    const filter = { userId: req.user._id };
    if (toolType) filter.toolType = toolType;
    
    const campaigns = await Campaign.find(filter);
    const totalCampaigns = campaigns.length;
    const totalRecipients = campaigns.reduce((sum, campaign) => sum + campaign.recipients.length, 0);
    
    const campaignIds = campaigns.map(c => c._id);
    const allOpenEvents = await TrackingEvent.find({ campaignId: { $in: campaignIds }, eventType: 'open' });
    const allClickEvents = await TrackingEvent.find({ campaignId: { $in: campaignIds }, eventType: 'click' });

    const totalUniqueOpens = [...new Set(allOpenEvents.map(e => e.recipientEmail))].length;
    const totalUniqueClicks = [...new Set(allClickEvents.map(e => e.recipientEmail))].length;
    const overallOpenRate = totalRecipients > 0 ? (totalUniqueOpens / totalRecipients) * 100 : 0;
    const overallClickRate = totalRecipients > 0 ? (totalUniqueClicks / totalRecipients) * 100 : 0;
    const overallNotOpenRate = 100 - overallOpenRate;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCampaigns = campaigns.filter(c => c.createdAt >= sevenDaysAgo).length;
    const recentOpenEvents = allOpenEvents.filter(e => e.timestamp >= sevenDaysAgo).length;
    const recentClickEvents = allClickEvents.filter(e => e.timestamp >= sevenDaysAgo).length;

    const campaignPerformance = await Promise.all(campaigns.map(async (campaign) => {
      const analytics = await calculateCampaignAnalytics(campaign._id, campaign.recipients.length);
      return { campaignId: campaign._id, campaignName: campaign.campaignName, createdAt: campaign.createdAt, ...analytics };
    }));

    const topCampaignsByOpenRate = campaignPerformance.sort((a, b) => b.openRate - a.openRate).slice(0, 5);

    res.json({
      summary: {
        totalCampaigns,
        totalRecipients,
        totalUniqueOpens,
        totalUniqueClicks,
        overallOpenRate: parseFloat(overallOpenRate.toFixed(2)),
        overallClickRate: parseFloat(overallClickRate.toFixed(2)),
        overallNotOpenRate: parseFloat(overallNotOpenRate.toFixed(2)),
        totalOpensCount: allOpenEvents.length,
        totalClicksCount: allClickEvents.length
      },
      recentActivity: { recentCampaigns, recentOpenEvents, recentClickEvents, last7Days: sevenDaysAgo },
      topPerformers: { byOpenRate: topCampaignsByOpenRate },
      allCampaignPerformance: campaignPerformance
    });
  } catch (error) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ error: 'Failed to fetch analytics summary', details: error.message });
  }
});

// Get latest campaigns
router.get('/latest-campaigns', authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(5).select('-smtpPassword');
    const campaignsWithStats = await Promise.all(campaigns.map(async (campaign) => {
      const analytics = await calculateCampaignAnalytics(campaign._id, campaign.recipients.length);
      return {
        ...campaign.toObject(),
        ...analytics,
        openRatePercent: `${analytics.openRate}%`,
        clickRatePercent: `${analytics.clickRate}%`,
        notOpenRatePercent: `${analytics.notOpenRate}%`
      };
    }));
    
    res.json(campaignsWithStats);
  } catch (error) {
    console.error('Error fetching latest campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch latest campaigns', details: error.message });
  }
});

// Open tracking endpoint
router.get('/track/open', async (req, res) => {
  const token = req.query.token;
  const trackingPixelBuffer = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
  
  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Content-Length': trackingPixelBuffer.length,
    'Access-Control-Allow-Origin': '*'
  });
  
  res.send(trackingPixelBuffer);
  
  if (token && token.length === 32) {
    setImmediate(async () => {
      try {
        const campaign = await Campaign.findOne({ 'recipients.trackingToken': token });
        if (!campaign) return;
        
        const recipient = campaign.recipients.find(r => r.trackingToken === token);
        if (!recipient) return;
        
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const recentOpen = await TrackingEvent.findOne({
          campaignId: campaign._id,
          recipientEmail: recipient.email,
          trackingToken: token,
          eventType: 'open',
          timestamp: { $gte: tenMinutesAgo }
        });
        
        if (recentOpen) return;
        
        const trackingEvent = new TrackingEvent({
          campaignId: campaign._id,
          recipientEmail: recipient.email,
          trackingToken: token,
          eventType: 'open',
          timestamp: new Date(),
          metadata: {
            userAgent: req.get('User-Agent') || 'Unknown',
            ipAddress: req.ip || req.connection?.remoteAddress || 'Unknown',
            referer: req.get('Referer') || 'Direct',
            acceptLanguage: req.get('Accept-Language') || 'Unknown'
          },
          campaignName: campaign.campaignName,
          userId: campaign.userId
        });
        
        await trackingEvent.save();
      } catch (error) {
        console.error('Error tracking open event:', error.message);
      }
    });
  }
});

// Click tracking endpoint
router.get('/track/click', async (req, res) => {
  const token = req.query.token;
  const url = req.query.url;
  
  if (!token || !url) return res.status(400).send('Missing required parameters');
  if (token.length !== 32) return res.status(400).send('Invalid token format');
  
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(url);
    new URL(decodedUrl);
  } catch (error) {
    return res.status(400).send('Invalid URL');
  }
  
  try {
    const campaign = await Campaign.findOne({ 'recipients.trackingToken': token });
    if (!campaign) return res.redirect(decodedUrl);
    
    const recipient = campaign.recipients.find(r => r.trackingToken === token);
    if (!recipient) return res.redirect(decodedUrl);
    
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const recentClick = await TrackingEvent.findOne({
      campaignId: campaign._id,
      recipientEmail: recipient.email,
      trackingToken: token,
      eventType: 'click',
      details: decodedUrl,
      timestamp: { $gte: thirtySecondsAgo }
    });
    
    if (recentClick) return res.redirect(decodedUrl);
    
    const trackingEvent = new TrackingEvent({
      campaignId: campaign._id,
      recipientEmail: recipient.email,
      trackingToken: token,
      eventType: 'click',
      timestamp: new Date(),
      details: decodedUrl,
      metadata: {
        userAgent: req.get('User-Agent') || 'Unknown',
        ipAddress: req.ip || req.connection?.remoteAddress || 'Unknown',
        referer: req.get('Referer') || 'Direct',
        acceptLanguage: req.get('Accept-Language') || 'Unknown'
      },
      campaignName: campaign.campaignName,
      userId: campaign.userId
    });
    
    await trackingEvent.save();
    res.redirect(decodedUrl);
    
  } catch (error) {
    console.error('Click tracking error:', error.message);
    res.redirect(decodedUrl);
  }
});

module.exports = router;
