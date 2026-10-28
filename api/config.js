// GET /api/config  → public settings the pages need.
import { submissionsOpen } from '../lib/http.js';

export default function handler(req, res) {
  res.status(200).json({
    open: submissionsOpen(),
    creatorName: process.env.CREATOR_NAME || '',
    portfolioUrl: process.env.PORTFOLIO_URL || '',
  });
}
