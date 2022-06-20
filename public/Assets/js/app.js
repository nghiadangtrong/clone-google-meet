var AppProcess = (function() {
  var peers_connection_ids = [],
    peers_connection = [],
    remote_vid_stream = [],
    remote_audi_stream = [];
  var serverProcess,
    my_connection_id, // id my socket
    local_video_div,
    audio,
    isAudioMute = true,
    rtp_aud_senders = [],
    video_states = {
      None: 0,
      Camera: 1,
      ScreenShare: 2
    },
    video_st = video_states.None,
    videoCamTrack,
    rtp_vid_senders = []
    ;

  async function _init(SDP_function, my_connId) {
    serverProcess = SDP_function;
    my_connection_id = my_connId;

    local_video_div = document.getElementById('localVideoPlayer');
    eventProcess();
  }

  function eventProcess() {
    console.log('[+] eventProcess')
    $("#miceMuteUnmute").on("click", async () => {
      // Load audio từ thiết bị
      if (!audio) {
        await loadAudio()
      }

      if (!audio) {
        return alert("Audio permission has not granted");
      }

      if (isAudioMute) {
        audio.enabled = true;
        $(this).html("<span class='material-icons'>mic</span>");
        updateMediaSenders(audio, rtp_aud_senders);
      } else {
        audio.enabled = false;
        $(this).html("<span class='material-icons'>mic-off</span>")
        removeMediaSenders(rtp_aud_senders);
      }
      isAudioMute = !isAudioMute;
    })

    $("#videoCamOnOff").on("click", async function() {
      if (video_st === video_states.Camera) {
        await videoProcess(video_states.None);
      } else {
        await videoProcess(video_states.Camera);
      }
    })

    $("#btnScreenShareOnOff").on("click", async function() {
      if (video_st === video_states.ScreenShare) {
        await videoProcess(video_states.None);
      } else {
        await videoProcess(video_states.ScreenShare)
      }
    })
  }

  async function loadAudio() {
    try {
      var astream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      })
      audio = astream.getAudioTracks()[0];
      audio.enabled = false;
    } catch (e) {
      console.log(e)
    }
  }

  function connection_status(connection) {
    if (connection && ["new", "connecting", "connected"].includes(connection.connectionState)) {
      return true;
    }
    return false;
  }

  async function updateMediaSenders(track, rtp_senders) {
    console.log('[+] updateMediaSenders: ', peers_connection_ids.length)
    for (var con_id in peers_connection_ids) {
      if (connection_status(peers_connection[con_id])) {

        if (rtp_senders[con_id] && rtp_senders[con_id].track) {
          console.log('[+] replaceTrack')
          rtp_senders[con_id].replaceTrack(track);
        } else {
          console.log('[+] addTrack')
          rtp_senders[con_id] = peers_connection[con_id].addTrack(track);
        }

      }
    }
  }

  function removeMediaSenders(rtp_senders) {
    for (var con_id in peers_connection_ids) {
      if (rtp_senders[con_id] && connection_status(peers_connection[con_id])) {
        peers_connection[con_id].removeTrack(rtp_senders[con_id]);
        rtp_senders[con_id] = null;
      }
    }
  }

  function removeVideoStream(rtp_vid_senders) {
    if (videoCamTrack) {
      videoCamTrack.stop();
      videoCamTrack = null;
      local_video_div.srcObject = null;
      removeMediaSenders(rtp_vid_senders)
    }
  }

  async function videoProcess(newVideoState) {
    if (newVideoState === video_states.None) {
      $("#videoCamOnOff").html("<span class='material-icons'>videocam_off</span>");

      $("#btnScreenShareOnOff").html(`
        <span class="material-icons">present_to_all</span> 
        <div>Present Now</div>
      `);
      video_st = newVideoState;

      removeVideoStream(rtp_vid_senders);

      return;
    }


    try {
      console.log('[+] video Process')
      var vstream = null;
      if (newVideoState === video_states.Camera) {
        vstream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 1920,
            height: 1080
          },
          audio: false
        })
      } else if (newVideoState === video_states.ScreenShare) {
        vstream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: 1920,
            height: 1080
          },
          audio: false
        })

        vstream.oninactive = (e) => {
          console.log('[+] oninactive')
          removeVideoStream(rtp_vid_senders);
          $("#btnScreenShareOnOff").html(
            '<span class="material-icons">present_to_all</span><div>Present Now</div>'
          )
        }
      }

      if (vstream && vstream.getVideoTracks().length > 0) {
        videoCamTrack = vstream.getVideoTracks()[0];
        if (videoCamTrack) {
          local_video_div.srcObject = new MediaStream([videoCamTrack]);
          updateMediaSenders(videoCamTrack, rtp_vid_senders);
        }
      }

    } catch (e) {
      console.log('[-] videoProcess: ', e)
      return;
    }

    video_st = newVideoState;

    if (newVideoState === video_states.Camera) {
      $("#videoCamOnOff").html("<span class='material-icons'>videocam_on</span>")
      $("#btnScreenShareOnOff").html(
        '<span class="material-icons">present_to_all</span><div>Present Now</div>'
      )
    } else {
      $("#videoCamOnOff").html("<span class='material-icons'>videocam_off</span>")
      $("#btnScreenShareOnOff").html(
        '<span class="material-icons text-success">present_to_all</span><div class="text-success">Stop Present Now</div>'
      )
    }
  }

  var iceConfiguration = {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302"
      },
      {
        urls: "stun:stun1.l.google.com:19302"
      }
    ]
  }

  async function setNewConnection(connId) {
    console.log('[+] setNewConnection')
    // https://developer.mozilla.org/en-US/docs/Glossary/ICE
    var connection = new RTCPeerConnection(iceConfiguration);

    connection.onicecandidate = function(event) {
      console.log('[+] onicecandidate')
      if (event.candidate) {
        console.log('[+] candidate: ', event.candidate)
        serverProcess(
          JSON.stringify({ icecandidate: event.candidate }),
          connId
        );
      }
    }

    // Quá trình thương lượng candidate(ứng viên) đã kết thúc
    connection.onnegotiationneeded = async function(event) {
      console.log('[+] onnegotiationneeded')
      await setOffer(connId);
    };

    connection.ontrack = function(event) {
      console.log('[+] ontrack')
      if (!remote_vid_stream[connId]) {
        remote_vid_stream[connId] = new MediaStream();
      }
      if (!remote_audi_stream[connId]) {
        remote_audi_stream[connId] = new MediaStream();
      }

      if (event.track.kind === "video") {
        remote_vid_stream[connId]
          .getVideoTracks()
          .forEach(t => remote_vid_stream[connId].removeTrack(t));

        remote_vid_stream[connId].addTrack(event.track);

        var remoteVideoPlayer = document.getElementById("v_" + connId);
        remoteVideoPlayer.srcObject = null;
        remoteVideoPlayer.srcObject = remote_vid_stream[connId];
        remoteVideoPlayer.load();
      } else if (event.track.kind === 'audio') {
        remote_audi_stream[connId]
          .getAudioTracks()
          .forEach(t => remote_audi_stream[connId].removeTrack(t));

        remote_audi_stream[connId].addTrack(event.track);

        var remoteAudioPlayer = document.getElementById("a_" + connId);
        remoteAudioPlayer.srcObject = null;
        remoteAudioPlayer.srcObject = remote_audi_stream[connId];
        remoteAudioPlayer.load();
      }

    }

    peers_connection_ids[connId] = connId;
    peers_connection[connId] = connection;

    if (
      [video_states.Camera, video_states.ScreenShare].includes(video_st) &&
      videoCamTrack
    ) {
      console.log('[+] after setNewConnection')
      updateMediaSenders(videoCamTrack, rtp_vid_senders);
    }

    return connection;
  }

  // Gửi offer (DSP - local) đến remote peer thông qua socket 
  async function setOffer(connId) {
    console.log('[+] setOffer')
    var connection = peers_connection[connId];
    console.log('[+] create Offer')
    var offer = await connection.createOffer();

    console.log('[+] setLocalDescription')
    await connection.setLocalDescription(offer);

    serverProcess(
      JSON.stringify({ offer: connection.localDescription }),
      connId
    )
  }

  async function SDPProcess(message, from_connId) {
    message = JSON.parse(message);

    if (message.answer) {
      console.log('[+] SDP answer')
      console.log('[+] setRemoteDescription')
      // Nhận được answer từ remote 
      //    -> Lưu lại answer (remote SDP)
      await peers_connection[from_connId]
        .setRemoteDescription(new RTCSessionDescription(message.answer));

    } else if (message.offer) {
      console.log('[+] SDP offer')
      // Nhận đươc offer từ remote 
      //    -> lưu lại remote SDP 
      //    -> Gửi answer (SDP - local) thông qua socket 
      if (!peers_connection[from_connId]) {
        await setNewConnection(from_connId);
      }

      console.log('[+] setRemoteDescription')
      await peers_connection[from_connId]
        .setRemoteDescription(new RTCSessionDescription(message.offer));

      console.log('[+] create answer')
      var answer = await peers_connection[from_connId].createAnswer();

      console.log('[+] setLocalDescription')
      await peers_connection[from_connId].setLocalDescription(answer);

      serverProcess(
        JSON.stringify({ answer: answer }),
        from_connId
      )
    } else if (message.icecandidate) { // Thêm ứng candiate nếu có lời đề nghị
      console.log('[+] SDP icecandidate')
      if (!peers_connection[from_connId]) {
        await setNewConnection(from_connId);
      }
      try {
        console.log('[+] addICeCandidate')
        await peers_connection[from_connId].addIceCandidate(message.icecandidate);
      } catch (e) {
        console.log('[-] error: add ice candidate - ', e)
      }
    }
  }

  async function closeConnection(connId) {
    peers_connection_ids[connId] = null;
    if (peers_connection[connId]) {
      peers_connection[connId].close();
      peers_connection[connId] = null;
    }

    if (remote_vid_stream[connId]) {
      remote_vid_stream[connId].getTracks().forEach(t => {
        if (t.stop) t.stop();
      })
      remote_vid_stream[connId] = null;
    }

    if (remote_audi_stream[connId]) {
      remote_audi_stream[connId].getTracks().forEach(t => {
        if (t.stop) t.stop();
      })
      remote_audi_stream[connId] = null;
    }
  }

  return {
    init: async function(SDP_function, my_connid) {
      await _init(SDP_function, my_connid);
    },
    setNewConnection: async function(connId) {
      await setNewConnection(connId);
    },
    processClientFunc: async function(message, from_connId) {
      await SDPProcess(message, from_connId);
    },
    closeConnectionCall: async function(connId) {
      await closeConnection(connId);
    }
  }
})();

var MyApp = (function() {
  var socket = null,
    user_id,
    meeting_id;

  function init(uid, mid) {
    user_id = uid;
    meeting_id = mid;

    $("#meetingContainer").show();
    $("#me h2").text(user_id + "(Me)");
    document.title = user_id;

    event_process_for_signaling_server();
    eventHandeling();
  }


  function event_process_for_signaling_server() {
    socket = io.connect();

    var SDP_function = function(data, to_connId) {
      socket.emit('SDPProcess', {
        message: data,
        to_connId: to_connId
      })
    }

    // Đăng ký user_id vs connect to meeting by id
    socket.on("connect", function() {
      if (!socket.connected) {
        return;
      }

      AppProcess.init(SDP_function, socket.id);

      if (user_id != "" && meeting_id != "") {
        socket.emit("userconnect", {
          user_id: user_id,
          meeting_id: meeting_id
        })
      }

    })

    socket.on("inform_me_about_other_user", function(other_users) {
      if (!Array.isArray(other_users)) {
        return
      }
      other_users.forEach(other_user => {
        addUser(other_user['user_id'], other_user['connectionId'])
        AppProcess.setNewConnection(other_user['connectionId'])
      })
    })


    // Lắng nghe khi có kết nối mới vào meeting
    socket.on("inform_others_about_me", function(data) {
      addUser(data.other_user_id, data.connId);
      // Tạo kết nốt PeerConnect
      AppProcess.setNewConnection(data.connId);
    })

    // Lắng nghe trao đổi SDP (session description protocol) thông qua socket
    socket.on("SDPProcess", async function(data) {
      await AppProcess.processClientFunc(data.message, data.from_connId)
    })


    // Lắng nghe remote client disconnect
    socket.on("inform_other_about_disconnected_user", async function(data) {
      console.log('[+] close connection: ', data.connId)
      $('#' + data.connId).remove();
      await AppProcess.closeConnectionCall(data.connId)
    })

    // listen new text message 
    socket.on("showChatMessage", (data) => {
      console.log('[+] showChatMessage: ', data)
      addMessageToDOM(data.from, data.message);
    })
  }

  function addMessageToDOM (fromUser, message) {
    var time = new Date();
    var lTime = time.toLocaleString("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: true
    });
    var div = $("<div>").html(
      `<span class='font-weight-bold mr-3' style='color: black'>${fromUser}</span>${lTime}<br/> ${message}`
    );
    $("#messages").append(div);
  }

  function eventHandeling() {
    $("#btnsend").on("click", function() {
      let inputMsg = $("#msgbox").val();
      socket.emit("sendMessage", inputMsg);
      addMessageToDOM(user_id + '(me)', inputMsg);
      $("#msgbox").val("")
    })
  }

  function addUser(other_user_id, connId) {
    var newDivId = $('#otherTemplate').clone();
    newDivId = newDivId.attr('id', connId).addClass('other');
    newDivId.find('h2').text(other_user_id);
    newDivId.find('video').attr('id', "v_" + connId);
    newDivId.find('audio').attr('id', 'a_' + connId);
    newDivId.show();
    $("#divUsers").append(newDivId);
  }

  return {
    _init: function(uid, mid) {
      init(uid, mid);
    }
  }
})();
