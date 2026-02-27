const linkService = require('./link.service');

const createLink = async (req, res, next) => {
  try {
    const link = await linkService.createLink(req.user.id);
    res.status(201).json(link);
  } catch (error) {
    next(error);
  }
};

const getLinkByCode = async (req, res, next) => {
  try {
    const link = await linkService.getLinkByCode(req.params.code);
    res.json(link);
  } catch (error) {
    next(error);
  }
};

const getMyLinks = async (req, res, next) => {
  try {
    const links = await linkService.getMyLinks(req.user.id);
    res.json(links);
  } catch (error) {
    next(error);
  }
};

const deactivateLink = async (req, res, next) => {
  try {
    const link = await linkService.deactivateLink(req.params.id, req.user.id);
    res.json(link);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createLink,
  getLinkByCode,
  getMyLinks,
  deactivateLink,
};
