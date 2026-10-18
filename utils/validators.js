const { body, query, param, validationResult } = require('express-validator');
const { isValidPhoneNumber } = require('./phoneNumber');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

const registerValidation = [
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_.]+$/)
    .withMessage('Username can only contain letters, numbers, dots and underscores'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone_number')
    .optional({ checkFalsy: true })
    .trim()
    .custom(isValidPhoneNumber)
    .withMessage('Enter a valid phone number with 7 to 15 digits'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  handleValidation,
];

const loginValidation = [
  body('identifier')
    .optional()
    .trim()
    .isLength({ min: 1, max: 254 })
    .withMessage('Enter a valid email, username, or phone number'),
  body('email')
    .optional()
    .trim()
    .isLength({ min: 1, max: 254 })
    .withMessage('Enter a valid email, username, or phone number'),
  body().custom((_, { req }) => {
    const identifier = req.body.identifier ?? req.body.email;
    return typeof identifier === 'string' && identifier.trim().length > 0;
  }).withMessage('Email, username, or phone number is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation,
];

const accountVerificationValidation = (confirmationRequired) => [
  body('current_password')
    .optional()
    .isString()
    .withMessage('Current password must be text'),
  body('google_credential')
    .optional()
    .isString()
    .withMessage('Google credential must be text'),
  body().custom((_, { req }) => (
    (typeof req.body.current_password === 'string' && req.body.current_password.length > 0) ||
    (typeof req.body.google_credential === 'string' && req.body.google_credential.length > 0)
  )).withMessage('Verify your account with your password or Google'),
  ...(confirmationRequired ? [
    body('username')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Username confirmation is required'),
    body('confirmation')
      .equals('DELETE MY ACCOUNT')
      .withMessage('Type DELETE MY ACCOUNT to confirm deletion'),
  ] : []),
];

const changePasswordValidation = [
  ...accountVerificationValidation(false),
  body('new_password')
    .isString()
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters'),
  handleValidation,
];

const verifyAccountValidation = [
  ...accountVerificationValidation(false),
  handleValidation,
];

const deleteAccountValidation = [
  body('verification_token')
    .isString()
    .notEmpty()
    .withMessage('Verify your account before requesting deletion'),
  body('username')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Username confirmation is required'),
  body('confirmation')
    .equals('DELETE MY ACCOUNT')
    .withMessage('Type DELETE MY ACCOUNT to confirm deletion'),
  handleValidation,
];

const googleAuthValidation = [
  body('credential')
    .isString()
    .notEmpty()
    .withMessage('Google credential is required'),
  handleValidation,
];

const profileUpdateValidation = [
  body('full_name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Full name cannot be empty'),
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_.]+$/)
    .withMessage('Username can only contain letters, numbers, dots and underscores'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Enter a valid email address'),
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio must be under 500 characters'),
  body('phone_number')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .custom(isValidPhoneNumber)
    .withMessage('Enter a valid phone number with 7 to 15 digits'),
  handleValidation,
];

const postValidation = [
  body('caption')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Caption must be under 2000 characters'),
  handleValidation,
];

const commentValidation = [
  body('comment_text')
    .trim()
    .notEmpty()
    .withMessage('Comment text is required')
    .isLength({ max: 1000 })
    .withMessage('Comment must be under 1000 characters'),
  handleValidation,
];

const messageValidation = [
  body('receiver_id')
    .isInt({ min: 1 })
    .withMessage('Valid receiver ID is required'),
  body('message_text')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Message must be under 5000 characters'),
  handleValidation,
];

const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  handleValidation,
];

const searchValidation = [
  query('q')
    .trim()
    .notEmpty()
    .withMessage('Search query is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Search query must be 1-50 characters'),
  handleValidation,
];

module.exports = {
  handleValidation,
  registerValidation,
  loginValidation,
  changePasswordValidation,
  verifyAccountValidation,
  deleteAccountValidation,
  googleAuthValidation,
  profileUpdateValidation,
  postValidation,
  commentValidation,
  messageValidation,
  paginationValidation,
  searchValidation,
};
