// middlewares/auth.js
const jwt = require("jsonwebtoken");
module.exports = (req,res,next)=>{
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) return res.sendStatus(401);
  try{
    req.user = jwt.verify(auth, process.env.JWT_SECRET); // {cid,role,exp}
    next();
  }catch{ res.sendStatus(401); }
};
