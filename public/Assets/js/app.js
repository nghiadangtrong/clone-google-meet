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
      var userNumber = other_users.length + 1;
      other_users.forEach(other_user => {
        addUser(other_user['user_id'], other_user['connectionId'], userNumber);
        AppProcess.setNewConnection(other_user['connectionId'])
      })
    })


    // Lắng nghe khi có kết nối mới vào meeting
    socket.on("inform_others_about_me", function(data) {
      addUser(data.other_user_id, data.connId, data.userNumber);
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
      $(".participant-count").text(data.userNumber);
      $("#participant_" + data.connId).remove();
      await AppProcess.closeConnectionCall(data.connId)
    })

    // listen new text message 
    socket.on("showChatMessage", (data) => {
      console.log('[+] showChatMessage: ', data)
      addMessageToDOM(data.from, data.message);
    })

    socket.on("showFileMessage", (data) => {
      addLinkAttachFileToDom({
        filePath: data.filePath,
        fileName: data.fileName,
        meetingId: data.meetingId,
        userId: data.userId
      })
    })
  }

  function addMessageToDOM(fromUser, message) {
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

    var url = window.location.href;
    $(".meeting_url").text(url);

    $("#divUsers").on("dblclick", "video", function () {
      this.requestFullscreen();
    })
  }

  function addUser(other_user_id, connId, userNumber) {
    var newDivId = $('#otherTemplate').clone();
    newDivId = newDivId.attr('id', connId).addClass('other');
    newDivId.find('h2').text(other_user_id);
    newDivId.find('video').attr('id', "v_" + connId);
    newDivId.find('audio').attr('id', 'a_' + connId);
    newDivId.show();
    $("#divUsers").append(newDivId);

    $(".in-call-wrap-up").append(`
      <div class="in-call-wrap d-flex justify-content-between align-items-center mb-3" id="participant_${connId}">
        <div class="participant-img-name-wrap display-center cursor-pointer">
          <div class="participant-img">
            <img src="Assets/images/other.jpg" alt="" class="border border-secondary" style="height: 40px; width: 40px; border-radius: 50%;" />
          </div>
          <div class="participant-name ml-2">${other_user_id}</div>
        </div>
        <div class="participant-action-wrap display-center">
          <div class="participant-action-dot display-center cursor-pointer">
            <span class="material-icons">more_vert</span>
          </div>

          <div class="participant-action-pin display-center mr-2 cursor-pointer">
            <span class="material-icons">push_pin</span>
          </div>
        </div>
      </div>
    `);

    $(".participant-count").text(userNumber);

  }

  $(document).on("click", ".people-heading", function() {
    $(".in-call-wrap-up").show(300);
    $(".chat-show-wrap").hide(300);
    $(this).addClass('active');
    $(".chat-heading").removeClass('active');
  })

  $(document).on("click", ".chat-heading", function() {
    $(".in-call-wrap-up").hide(300);
    $(".chat-show-wrap").show(300);
    $(this).addClass('active');
    $(".people-heading").removeClass('active');
  })

  $(document).on("click", ".meeting-heading-cross", function () {
    $(".g-right-details-wrap").hide(300);
  })

  $(document).on("click", ".top-left-participant-wrap", function () {
    $(".people-heading").addClass('active');
    $(".chat-heading").removeClass('active');
    $(".g-right-details-wrap").show(300);
    $(".in-call-wrap-up").show(300);
    $(".chat-show-wrap").hide(300);
  })

  $(document).on("click", ".top-left-chat-wrap", function () {
    $(".people-heading").removeClass('active');
    $(".chat-heading").addClass('active');
    $(".g-right-details-wrap").show(300);
    $(".in-call-wrap-up").hide(300);
    $(".chat-show-wrap").show(300);
  })

  $(document).on("click", ".end-call-wrap", function () {
    $(".top-box-show")
      .css({ "display": "block" })
      .html(`
        <div class="top-box align-vertical-middle profile-dialogue-show">
          <h1 class="mt-2" style="text-align: center; color: white;">Leave Meeting</h1> <hr/> <div class="call-leave-cancel-action d-flex justify-content-center align-items-center w-100"> <a href="/action.html">
              <button class="call-leave-action btn btn-danger mr-5">Leave</button>
            </a>
            <button class="call-cancel-action btn btn-secondary">Cancel</button>
          </div>
        </div>
      `);
  })

  $(document).mouseup(function (e) {
    var container = new Array();
    container.push($(".top-box-show"));
    $.each(container, function (key, value) {
      if (!$(value).is(e.target) && $(value).has(e.target).length == 0) {
        $(value).empty();
      }
    })
  })

  $(document).mouseup(function (e) {
    var container = new Array();
    container.push($(".g-details"));
    container.push($(".g-right-details-wrap"));
    $.each(container, function (key, value) {
      if (!$(value).is(e.target) && $(value).has(e.target).length == 0) {
        $(value).hide(300);
      }
    })
  })

  $(document).on("click", ".call-cancel-action", function () {
    $(".top-box-show").html('')
  })

  $(document).on('click', '.copy_info', function () {
    var $temp = $("<input>");
    $("body").append($temp);
    $temp.val($(".meeting_url").text()).select();
    document.execCommand("copy");
    $temp.remove();

    $('.link-conf').show();
    setTimeout(function () {
      $('.link-conf').hide();
    }, 3000);
  });

  $(document).on("click", ".meeting-details-button", function () {
    $(".g-details").slideDown(300);
  })

  $(document).on("click", ".g-details-heading-attachment", function () {
    $(".g-details-heading-show").hide();
    $(".g-details-heading-show-attachment").show();
    $(this).addClass('active');
    $(".g-details-heading-detail").removeClass('active');
  })

  $(document).on("click", ".g-details-heading-detail", function () {
    $(".g-details-heading-show").show();
    $(".g-details-heading-show-attachment").hide();
    $(this).addClass('active');
    $(".g-details-heading-attachment").removeClass('active');
  })

  var base_url = window.location.origin;
  
  $(document).on('change', "#customFile", function () {
    var filename = $(this).val().split("\\").pop();
    // console.log('[+] value: ', $(this).val().split("\\"));
    $(this).siblings(".custom-file-label").addClass("selected").html(filename)
  })

  const addLinkAttachFileToDom = ({ filePath, fileName, meetingId, userId }) => {
    var time = (new Date()).toLocaleString('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
    var attachFileElement = document.querySelector(".show-attach-file");
    attachFileElement.innerHTML += `
      <div class="left-align d-flex align-items-center">
        <img src="Assets/images/other.jpg" 
          class="caller-image circle" 
          style="height: 40px; width: 40px;"/>
        <div style="font-weight: 600; margin: 0 5px;">${userId}</div>:
        <div>
          <a style="color: #007bff;" href="${filePath}">${fileName}</a>
          <div class="text-secondary">${time}</div>
        </div>
      </div>
    `;

    $("label.custom-file-label").text("");
  }

  $(document).on('click', '.share-attach', function (e) {
    e.preventDefault();
    var _this = this;
    // input file
    var att_img = $('#customFile').prop('files')[0];
    var formData = new FormData();
    formData.append("zipfile", att_img);
    formData.append("meetingId", meeting_id);
    formData.append("userId", user_id);
    if (!att_img) {
      return; 
    }
    $(_this).attr({ 'disabled': true})
    $.ajax({
      url: base_url+"/attach-img",
      type: "POST",
      data: formData,
      contentType: false,
      processData: false,
      success: function (response) {
        $(_this).attr({ 'disabled': false})
        $('#customFile').val("")
        addLinkAttachFileToDom({
          fileName: response.fileName,
          filePath: response.filePath,
          meetingId: response.meetingId,
          userId: response.userId
        }) 

        socket.emit("fileTransferToOther", {
          fileName: response.fileName,
          filePath: response.filePath,
          meetingId: response.meetingId,
          userId: response.userId
        })
      },
      error: function () {
        console.log("[-] Error send form")
        $(_this).attr({ 'disabled': false})
      }
    })
  })


  /******** start record ********/
  var mediaRecorder;
  var chunks = [];

  $(document).on('click', '.option-icon', function () {
    $('.record-show').toggle(300);
  })

  $(document).on('click', '.start-recording', function () {
    $(this).removeClass()
      .addClass('btn stop-recording text-secondary')
      .text('Stop recording')

    startRecording();
  })

  $(document).on('click', '.stop-recording', function () {
    $(this).removeClass()
      .addClass('btn start-recording text-danger')
      .text("Start recording")
    mediaRecorder.stop();
  })

  function getScreenStream () {
    return navigator.mediaDevices.getDisplayMedia({
      video: true
    })
  } 

  function getAudioStream () {
    return navigator.mediaDevices.getUserMedia({
      video: false,
      audio: true
    })
  }


  async function startRecording() {
    var screenStream = await getScreenStream();
    var audioStream = await getAudioStream();
    var stream = new MediaStream([
      ...screenStream.getTracks(), 
      ...audioStream.getTracks()
    ]);

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();
    mediaRecorder.onstop = function () {
      console.log('[+] onstop')
      stream.getTracks().forEach(track => track.stop());
      
      var data = new Blob(chunks, {
        type: 'video/webm'
      });
      chunks = [];
      var url = window.URL.createObjectURL(data);
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'true'
      document.body.append(a);
      a.click();

      setTimeout(() => {
        a.remove();
        window.URL.revokeObjectURL(url)
      }, 200);
    }

    mediaRecorder.ondataavailable = function (a) {
      console.log('[+] ondataavailable')
      chunks.push(a.data);
    }
  }

  return {
    _init: function(uid, mid) {
      init(uid, mid);
    }
  }
})();
