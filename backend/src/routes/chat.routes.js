import { Router }        from 'express'
import { authenticate }  from '#middlewares/authenticate.js'
import * as ctrl         from '#controllers/chat.controller.js'

const router = Router()
router.use(authenticate)

router.get ('/users',                         ctrl.listChatableUsers)
router.get ('/',                              ctrl.listChannels)
router.post('/',                              ctrl.createChannel)
router.get ('/:id/messages',                  ctrl.listMessages)
router.post('/:id/messages',                  ctrl.sendTextMessage)
router.post('/:id/messages/attachments',      ctrl.uploadAttachment)
router.get ('/attachments/:attachmentId/url', ctrl.getAttachmentUrl)
router.delete('/messages/:messageId',         ctrl.deleteMessage)

export default router
