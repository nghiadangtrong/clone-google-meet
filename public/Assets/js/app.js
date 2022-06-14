var AppProcess = (function() {
  var peers_connection_ids = [],
    peers_connection = []
    remote_vid_stream = [],
    remote_audi_stream = [];
  var serverProcess,
    my_connection_id, // id my socket
    local_video_div,
    audio,
    isAudioMute = true,
    rtp_aud_senders,
    video_states = {
      None: 0,
      Camera: 1,
      ScreenShare: 2
    },
    video_st = video_states.None,
    videoCamTrack
  ;

  async function _init(SDP_function, my_connId) {
    serverProcess = SDP_function;
    my_connection_id = my_connId;

    local_video_div = document.getElementById('localVideoPlayer');
    eventProcess();
  }

  function eventProcess() {
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
        $(this).html("<span class='material-icon'>mic</span>");
        updateMediaSenders(audio, rtp_aud_senders);
      } else {
        audio.enabled = false;
        $(this).html("<span class='material-icon'>mic-off</span>")
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

  async function videoProcess(newVideoState) {
    try {
      var vstream = null;
      if (newVideoState === video_states.Camera) {
        vstream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 1920,
            height: 1080
          },
          audio: false
        })
      } else  if (newVideoState === video_states.ScreenShare) {
        vstream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: 1920,
            height: 1080
          },
          audio: false
        })
      }

      if (vstream && vstream.getVideoTracks().length > 0) {
        videoCamTrack = vstream.getVideoTracks()[0];
        if (videoCamTrack) {
          local_video_div.srcObject = new MediaStream([ videoCamTrack ]);
          window.alert("Found camera")
        }
      }

    } catch(e) {
      console.log('[-] videoProcess: ', e)
      return;
    }

    video_st = newVideoState;
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
    // https://developer.mozilla.org/en-US/docs/Glossary/ICE
    var connection = new RTCPeerConnection(iceConfiguration);

    // step 3.1: Hình thức tự đề cử kết nối
    connection.onicecandidate = function(event) {
      if (event.candidate) {
        serverProcess(
          JSON.stringify({ icecandidate: event.candidate }),
          connId
        );
      }
    }

    // step 3.3: Quá trình thương lượng candidate(ứng viên) đã kết thúc
    connection.onnegotiationneeded = async function(event) {
      await setOffer(connId);
    };

    connection.ontrack = function(event) {
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

    return connection;
  }

  // step 3.4: Gửi offer (DSP - local) đến remote peer thông qua socket 
  async function setOffer(connId) {
    var connection = peers_connection[connId];
    var offer = await connection.createOffer();

    await connection.setLocalDescription(offer);

    serverProcess(
      JSON.stringify({ offer: connection.localDescription }),
      connId
    )
  }

  async function SDPProcess(message, from_connId) {
    message = JSON.parse(message);

    if (message.answer) {
      // step 3.4: Nhận được answer từ remote 
      //    -> Lưu lại answer (remote SDP)
      await peers_connection[from_connId]
        .setRemoteDescription(new RTCSessionDescription(message.answer));

    } else if (message.offer) {
      // step 3.5: Nhận đươc offer từ remote 
      //    -> lưu lại remote SDP 
      //    -> Gửi answer (SDP - local) thông qua socket 
      if (!peers_connection[from_connId]) {
        await setNewConnection(from_connId);
      }

      await peers_connection[from_connId]
        .setRemoteDescription(new RTCSessionDescription(message.offer));

      var answer = await peers_connection[from_connId].createAnswer();

      await peers_connection[from_connId].setLocalDescription(answer);

      serverProcess(
        JSON.stringify({ answer: answer }),
        from_connId
      )
    } else if (message.icecandidate) { // step 3.2: thêm ứng candiate nếu có lời đề nghị
      if (!peers_connection[from_connId]) {
        await setNewConnection(from_connId);
      }
      try {
        await peers_connection[from_connId].addIceCandidate(message.icecandidate);
      } catch (e) {
        console.log('[-] error: add ice candidate - ', e)
      }
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
  }


  function event_process_for_signaling_server() {
    socket = io.connect();

    var SDP_function = function(data, to_connId) {
      socket.emit('SDPProcess', {
        message: data,
        to_connId: to_connId
      })
    }

    // step 1: Đăng ký user_id vs connect to meeting by id
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


    // step 2: Lắng nghe khi có kết nối mới vào meeting
    socket.on("inform_others_about_me", function(data) {
      addUser(data.other_user_id, data.connId);
      // Step 3: Tạo kết nốt PeerConnect
      AppProcess.setNewConnection(data.connId);
    })

    // step 3.x: Lắng nghe trao đổi SDP (session description protocol) thông qua socket
    socket.on("SDPProcess", async function(data) {
      await AppProcess.processClientFunc(data.message, data.from_connId)
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
