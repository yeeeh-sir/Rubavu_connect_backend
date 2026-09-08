const { body, query, param, validationResult } = require('express-validator');

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
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  handleValidation,
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation,
];

const googleAuthValidation = [
  body('credential').notEmpty().withMessage('Google credential is required'),
  handleValidation,
];

const profileUpdateValidation = [
  body('full_name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Full name cannot be empty'),
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio must be under 500 characters'),
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
  googleAuthValidation,
  profileUpdateValidation,
  postValidation,
  commentValidation,
  messageValidation,
  paginationValidation,
  searchValidation,
};
