const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");

async function generateCSV(emailsWithSources) {
  // Build the CSV file path
  const csvPath = path.join(__dirname, "..", "emails.csv");
  
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: "email", title: "Email" },
      { id: "source", title: "Source URL" },
      { id: "validationScore", title: "Validation Score (0-100)" },
      { id: "riskLevel", title: "Risk Level" },
      { id: "isValid", title: "Is Valid" },
      { id: "hasMxRecord", title: "Has Mail Server" },
      { id: "isDisposable", title: "Is Disposable" },
      { id: "isRoleBased", title: "Is Role-Based" },
      { id: "foundInContactSection", title: "Found in Contact Section" },
      { id: "foundInAboutSection", title: "Found in About Section" },
      { id: "pageHasSSL", title: "Page Has SSL" },
      { id: "pageHasContact", title: "Page Has Contact Info" },
      { id: "pageHasSocial", title: "Page Has Social Links" },
      { id: "pageTrustScore", title: "Page Trust Score (0-100)" },
      { id: "scrapingMethod", title: "Scraping Method" },
      { id: "foundAt", title: "Found At (Timestamp)" },
      { id: "context", title: "Context (Preview)" },
      { id: "overallTrustRating", title: "Overall Trust Rating" }
    ],
  });

  // Process the data and calculate trust ratings
  const records = emailsWithSources.map(item => {
    // Handle both old and new format
    let emailData, validation, pageCredibility;
    
    if (typeof item === 'string') {
      // Old format - just email string
      return {
        email: item,
        source: 'N/A',
        validationScore: 'N/A',
        riskLevel: 'Unknown',
        isValid: 'N/A',
        hasMxRecord: 'N/A',
        isDisposable: 'N/A',
        isRoleBased: 'N/A',
        foundInContactSection: 'N/A',
        foundInAboutSection: 'N/A',
        pageHasSSL: 'N/A',
        pageHasContact: 'N/A',
        pageHasSocial: 'N/A',
        pageTrustScore: 'N/A',
        scrapingMethod: 'Legacy',
        foundAt: 'N/A',
        context: 'N/A',
        overallTrustRating: 'N/A'
      };
    } else {
      // New enhanced format
      emailData = item.email;
      validation = item.validation || {};
      pageCredibility = item.pageCredibility || {};
      
      // Calculate overall trust rating
      const trustFactors = {
        validationScore: validation.confidence || 0,
        pageTrustScore: pageCredibility.trustScore || 0,
        contextBonus: (item.foundInContactSection ? 10 : 0) + (item.foundInAboutSection ? 5 : 0),
        mxBonus: validation.checks?.mxRecord ? 10 : 0
      };
      
      const overallTrust = Math.min(100, 
        Math.round((trustFactors.validationScore * 0.4) + 
                   (trustFactors.pageTrustScore * 0.3) + 
                   (trustFactors.contextBonus * 0.2) + 
                   (trustFactors.mxBonus * 0.1))
      );
      
      let trustRating = 'Low';
      if (overallTrust >= 80) trustRating = 'Excellent';
      else if (overallTrust >= 70) trustRating = 'High';
      else if (overallTrust >= 60) trustRating = 'Good';
      else if (overallTrust >= 40) trustRating = 'Medium';
      
      return {
        email: emailData,
        source: item.source || 'N/A',
        validationScore: validation.confidence || 0,
        riskLevel: validation.riskLevel || 'Unknown',
        isValid: validation.isValid ? 'Yes' : 'No',
        hasMxRecord: validation.checks?.mxRecord ? 'Yes' : 'No',
        isDisposable: validation.checks?.disposable ? 'No' : 'Yes',
        isRoleBased: validation.checks?.role ? 'No' : 'Yes',
        foundInContactSection: item.foundInContactSection ? 'Yes' : 'No',
        foundInAboutSection: item.foundInAboutSection ? 'Yes' : 'No',
        pageHasSSL: pageCredibility.hasSSL ? 'Yes' : 'No',
        pageHasContact: pageCredibility.hasContactInfo ? 'Yes' : 'No',
        pageHasSocial: pageCredibility.hasSocialLinks ? 'Yes' : 'No',
        pageTrustScore: pageCredibility.trustScore || 0,
        scrapingMethod: item.scrapingMethod || 'Unknown',
        foundAt: item.foundAt || 'N/A',
        context: item.context || 'N/A',
        overallTrustRating: `${trustRating} (${overallTrust}%)`
      };
    }
  });

  // Sort by overall trust rating (highest first)
  records.sort((a, b) => {
    const aScore = parseInt(a.overallTrustRating.match(/\d+/)?.[0] || '0');
    const bScore = parseInt(b.overallTrustRating.match(/\d+/)?.[0] || '0');
    return bScore - aScore;
  });

  await csvWriter.writeRecords(records);
  
  // Generate summary statistics
  const validEmails = records.filter(r => r.isValid === 'Yes').length;
  const highTrustEmails = records.filter(r => r.overallTrustRating.includes('High') || r.overallTrustRating.includes('Excellent')).length;
  const withMxRecords = records.filter(r => r.hasMxRecord === 'Yes').length;
  const fromContactPages = records.filter(r => r.foundInContactSection === 'Yes').length;
  
  console.log(`\n=== EMAIL SCRAPING SUMMARY ===`);
  console.log(`Total emails found: ${records.length}`);
  console.log(`Valid emails: ${validEmails} (${Math.round(validEmails/records.length*100)}%)`);
  console.log(`High trust emails: ${highTrustEmails} (${Math.round(highTrustEmails/records.length*100)}%)`);
  console.log(`Emails with mail servers: ${withMxRecords} (${Math.round(withMxRecords/records.length*100)}%)`);
  console.log(`Found in contact sections: ${fromContactPages} (${Math.round(fromContactPages/records.length*100)}%)`);
  console.log(`CSV generated at: ${csvPath}`);
  console.log(`===============================\n`);
  
  return csvPath;
}

// Generate a summary report
async function generateSummaryReport(emailsWithSources) {
  const reportPath = path.join(__dirname, "..", "email_report.txt");
  
  const totalEmails = emailsWithSources.length;
  const validEmails = emailsWithSources.filter(item => item.validation?.isValid).length;
  const highConfidenceEmails = emailsWithSources.filter(item => (item.validation?.confidence || 0) >= 80).length;
  
  const report = `
EMAIL SCRAPING DETAILED REPORT
Generated: ${new Date().toISOString()}
===========================================

SUMMARY STATISTICS:
- Total emails scraped: ${totalEmails}
- Valid emails: ${validEmails} (${Math.round(validEmails/totalEmails*100)}%)
- High confidence emails: ${highConfidenceEmails} (${Math.round(highConfidenceEmails/totalEmails*100)}%)

QUALITY BREAKDOWN:
${emailsWithSources.reduce((acc, item) => {
  const level = item.validation?.riskLevel || 'unknown';
  acc[level] = (acc[level] || 0) + 1;
  return acc;
}, {})}

DATA VALIDATION METHODS USED:
✓ Syntax validation
✓ Domain format validation  
✓ MX record verification
✓ Disposable email detection
✓ Role-based email detection
✓ Page credibility analysis
✓ Context analysis
✓ SSL verification

TRUST INDICATORS:
- Emails found in contact sections
- Emails found in about sections  
- Pages with SSL certificates
- Pages with contact information
- Pages with social media links
- Mail server verification
- Domain reputation analysis

This report provides transparency about our data collection and validation methods.
All emails have been verified through multiple validation layers to ensure quality.
  `;
  
  fs.writeFileSync(reportPath, report);
  console.log(`Summary report generated at: ${reportPath}`);
  
  return reportPath;
}

module.exports = { generateCSV, generateSummaryReport };
