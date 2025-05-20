/**
 * Debug utility to check config values
 * Run this file directly to check configuration settings
 */

try {
  console.log('Checking environment and configuration...');

  // Check environment variables
  console.log('\nEnvironment Variables:');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  
  // Load configuration
  console.log('\nLoading configuration files...');
  
  try {
    const config = require('../config/secret');
    console.log('\nCashfree Configuration:');
    console.log('cashfreeAppId exists:', !!config.cashfreeAppId);
    console.log('cashfreeSecretKey exists:', !!config.cashfreeSecretKey);
    
    // Check if cashfreeApiBaseUrl exists
    const baseUrlExists = !!config.cashfreeApiBaseUrl;
    console.log('cashfreeApiBaseUrl exists:', baseUrlExists);
    
    if (baseUrlExists) {
      console.log('cashfreeApiBaseUrl value:', config.cashfreeApiBaseUrl);
    } else {
      console.log('WARNING: cashfreeApiBaseUrl is missing from config/secret.js!');
      console.log('It should be added to config/secret.js as:');
      console.log('module.exports = { ..., cashfreeApiBaseUrl: "https://api.cashfree.com/pg/v2" }');
    }
    
    // Check other required config values
    console.log('\nOther important configuration:');
    console.log('frontendUrl exists:', !!config.frontendUrl);
    console.log('frontendUrl value:', config.frontendUrl);
    console.log('notifyUrl exists:', !!config.notifyUrl);
    console.log('notifyUrl value:', config.notifyUrl);
    
  } catch (error) {
    console.error('Error loading configuration:', error.message);
  }
  
  console.log('\nChecking plans configuration...');
  try {
    const plans = require('../config/plans');
    console.log('PLANS object exists:', !!plans.PLANS);
    console.log('Available plans:', Object.keys(plans.PLANS));
    
    // Check a sample plan structure
    const samplePlan = Object.values(plans.PLANS)[0];
    if (samplePlan) {
      console.log('Sample plan structure:', {
        price: samplePlan.price,
        hasDuration: !!samplePlan.durationMs
      });
    }
  } catch (error) {
    console.error('Error loading plans:', error.message);
  }
  
  console.log('\nDiagnostic complete.');
} catch (error) {
  console.error('Diagnostic failed:', error);
}
