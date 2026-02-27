const trustService = require('./trust.service');

const getTrust = async (req, res, next) => {
  try {
    const trust = await trustService.getTrust(req.params.conversationId);
    res.json(trust || { status: 'new' });
  } catch (error) {
    next(error);
  }
};

const upgradeTrust = async (req, res, next) => {
  try {
    const trust = await trustService.upgradeTrust(req.params.conversationId);
    res.json(trust);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTrust,
  upgradeTrust,
};
