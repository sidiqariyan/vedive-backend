// middleware/paymentValidation.js
const Joi = require('joi');

const paymentSchema = Joi.object({
  planId: Joi.string()
    .valid('free', 'starter', 'business', 'enterprise')
    .required()
    .messages({
      'any.required': 'Plan ID is required',
      'string.empty': 'Plan ID cannot be empty',
      'any.only': 'Invalid plan selected'
    }),
  amount: Joi.number()
    .min(0)
    .required()
    .messages({
      'number.base': 'Amount must be a number',
      'number.min': 'Amount cannot be negative'
    }),
  currency: Joi.string()
    .valid('INR')
    .default('INR')
});

exports.validatePaymentRequest = (req, res, next) => {
  const { error } = paymentSchema.validate(req.body, { abortEarly: false });
  
  if (error) {
    const errors = error.details.map(err => ({
      field: err.context.key,
      message: err.message
    }));
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }
  
  next();
};

exports.validateWebhookSignature = (req, res, next) => {
  const signature = req.headers['x-webhook-signature'];
  const generatedSignature = crypto
    .createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('base64');

  if (signature !== generatedSignature) {
    return res.status(401).json({ 
      success: false,
      message: 'Invalid webhook signature' 
    });
  }
  
  next();
};