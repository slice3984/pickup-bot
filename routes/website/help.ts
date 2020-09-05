import express from 'express';

export default (req: express.Request, res: express.Response) => {
    res.render('homepage/help', { liveReload: process.env.DEBUG });
}