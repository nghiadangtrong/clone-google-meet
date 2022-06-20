const express = require("express");
const path = require("path");
const app = express();
const port = 3000;


app.use(express.static(path.join(__dirname, "public")));

const server = require("http").createServer(app);


server.listen(port, function () {
  console.log(`[+] Server is running on port ${port}`);
});


/******** socket io ********/
const io = require("socket.io")(server);

var userConnections = [];

io.on('connection', (socket) => {
  console.log('socket id is', socket.id);
  
  socket.on("userconnect", (data) => {

    console.log('data: ', data)
    var other_users = userConnections.filter(userConnect => userConnect.meeting_id === data.meeting_id);

    userConnections.push({
      connectionId: socket.id,
      user_id: data.user_id,
      meeting_id: data.meeting_id
    })

    // Gửi thông tin client mới cho các client khác ở trong team
    other_users.forEach(userConnect => {
      socket.to(userConnect.connectionId).emit("inform_others_about_me", {
        other_user_id: data.user_id,
        connId: socket.id
      })
    })

    // Gửi thông tin các soket trong meeting cho client mới
    socket.emit("inform_me_about_other_user", other_users)
  })

  socket.on("SDPProcess", (data) => {
    socket.to(data.to_connId).emit("SDPProcess", {
      message: data.message,
      from_connId: socket.id
    })
  })

  socket.on("sendMessage", function (msg) {
    var mUser = userConnections.find(u => u.connectionId === socket.id);
    console.log("[+] send message: ", msg)
    if (!mUser) {
      return 
    }
    var meetingId = mUser.meeting_id;
    var from = mUser.user_id;
    var users = userConnections.filter(u => u.meeting_id === meetingId);

    users.forEach(v => {
      console.log('[+] send to user_id: ', v.user_id)
      socket.to(v.connectionId).emit("showChatMessage", {
        from: from,
        message: msg
      })
    })
  })

  socket.on("disconnect", () => {
    let disUser = userConnections.find(user => user.connectionId === socket.id)
    console.log('goi disconnect')
    if (!disUser) {
      return;
    }
    let meeting_id = disUser.meeting_id;
    userConnections = userConnections.filter(user => user.connectionId !== socket.id);
    let other_users = userConnections.filter(user => user.meeting_id === meeting_id);
    other_users.forEach(user => {
      socket.to(user.connectionId).emit(
        "inform_other_about_disconnected_user",
        { connId: socket.id }
      )
    })
  })
})
