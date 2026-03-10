const linkService = require('./link.service');
const logger = require('../../utils/logger');

const createLink = async (req, res, next) => {
  try {
    logger.info({ userId: req.user.id }, '[link.controller] createLink called');
    const link = await linkService.createLink(req.user.id);
    logger.info({ userId: req.user.id, linkId: link.id, code: link.code }, '[link.controller] createLink OK');
    res.status(201).json(link);
  } catch (error) {
    logger.error({ err: error, userId: req.user?.id }, '[link.controller] createLink FAILED');
    next(error);
  }
};

const getLinkByCode = async (req, res, next) => {
  try {
    logger.info({ code: req.params.code }, '[link.controller] getLinkByCode called');
    const link = await linkService.getLinkByCode(req.params.code);
    logger.info({ code: req.params.code, linkId: link.id }, '[link.controller] getLinkByCode OK');
    res.json(link);
  } catch (error) {
    logger.error({ err: error, code: req.params.code }, '[link.controller] getLinkByCode FAILED');
    next(error);
  }
};

const getMyLinks = async (req, res, next) => {
  try {
    logger.info({ userId: req.user.id }, '[link.controller] getMyLinks called');
    const links = await linkService.getMyLinks(req.user.id);
    logger.info({ userId: req.user.id, count: links.length }, '[link.controller] getMyLinks OK');
    res.json(links);
  } catch (error) {
    logger.error({ err: error, userId: req.user?.id }, '[link.controller] getMyLinks FAILED');
    next(error);
  }
};

const deactivateLink = async (req, res, next) => {
  try {
    logger.info({ linkId: req.params.id, userId: req.user.id }, '[link.controller] deactivateLink called');
    const link = await linkService.deactivateLink(req.params.id, req.user.id);
    logger.info({ linkId: req.params.id }, '[link.controller] deactivateLink OK');
    res.json(link);
  } catch (error) {
    logger.error({ err: error, linkId: req.params.id }, '[link.controller] deactivateLink FAILED');
    next(error);
  }
};

module.exports = {
  createLink,
  getLinkByCode,
  getMyLinks,
  deactivateLink,
};
