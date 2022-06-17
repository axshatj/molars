let camera,
  scene,
  renderer,
  user_options,
  orbit_ctrl,
  trfm_ctrl,
  orig_geom,
  smooth_geom,
  group;
const exportButton = document.getElementById("export");
const canvas = document.getElementById("canvas");
let subd_level = 0;
let smooth_mesh;
let smooth_verts_undeformed = [];
let model_scale;

// FFD: control points of a lattice
let ffd = new FFD();
let MIN_SPAN_COUNT = 1;
let MAX_SPAN_COUNT = 8;
let span_counts = [2, 2, 2];
let ctrl_pt_geom = new THREE.SphereGeometry(2.5, 32, 32);
let ctrl_pt_material = new THREE.MeshLambertMaterial({ color: 0xfff000 });
let ctrl_pt_meshes = [];
let ctrl_pt_mesh_selected = null;
let lattice_lines = [];
let lattice_line_material = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.3,
});
let models = [];
let selected_model = null;
// Evaluated points
// let eval_pt_spans = new THREE.Vector3(16, 16, 16);
// let eval_pt_counts = new THREE.Vector3(
//   eval_pt_spans.x + 1,
//   eval_pt_spans.y + 1,
//   eval_pt_spans.z + 1
// );
// let eval_pts_geom = new THREE.Geometry();
// let eval_pts_mesh;

let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

const exporter = new THREE.STLExporter();
let createSomething = function (klass, args) {
  let F = function (klass, args) {
    return klass.apply(this, args);
  };
  F.prototype = klass.prototype;
  return new F(klass, args);
};

const loaderSTL = new THREE.STLLoader();

// start scene
init();
console.log(models);
animate();

function init() {
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    100000
  );
  camera.position.z = 650;
  scene = new THREE.Scene();
  // Group
  group = new THREE.Group();
  group.translateY(100);
  group.rotation.x = Math.PI / 3;
  scene.add(group);
  // Light
  let light = new THREE.PointLight(0x6c6b6b, 1.5);
  light.position.set(1000, 1000, 2000);
  scene.add(light);

  let ambientLight = new THREE.AmbientLight(0x6c6b6b, 1.5);
  scene.add(ambientLight);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setClearColor(0x000000);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.addEventListener("mousemove", onDocumentMouseMove, false);
  renderer.domElement.addEventListener("mousedown", onDocumentMouseDown, false);

  // Orbit controls
  orbit_ctrl = new THREE.OrbitControls(camera, renderer.domElement);
  orbit_ctrl.damping = 0.2;
  orbit_ctrl.addEventListener("change", render);
  trfm_ctrl = new THREE.TransformControls(camera, renderer.domElement);
  trfm_ctrl.addEventListener("change", render);
  scene.add(trfm_ctrl);

  trfm_ctrl.addEventListener("objectChange", function (e) {
    updateLattice();
    deform();
  });

  window.addEventListener("resize", onWindowResize, false);
  window.addEventListener("mousedown", modelSelection, false);
  window.addEventListener("keydown", keyDown, false);
  // createEvalPtsMesh();
  addModel();

  exportButton.addEventListener("click", function () {
    let stl = exporter.parse(smooth_mesh);
    let blob = new Blob([stl], { type: "text/plain" });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mesh.stl";
    a.click();
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onDocumentMouseMove(event) {
  event.preventDefault();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObjects(ctrl_pt_meshes);
  if (intersects.length > 0 && ctrl_pt_mesh_selected != intersects[0].object) {
    canvas.style.cursor = "pointer";
  } else {
    canvas.style.cursor = "auto";
  }
}

function onDocumentMouseDown(event) {
  event.preventDefault();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObjects(ctrl_pt_meshes);
  if (intersects.length > 0 && ctrl_pt_mesh_selected != intersects[0].object) {
    orbit_ctrl.enabled = false;
    if (ctrl_pt_mesh_selected) trfm_ctrl.detach(trfm_ctrl.object);
    ctrl_pt_mesh_selected = intersects[0].object;
    trfm_ctrl.attach(ctrl_pt_mesh_selected);
  } else {
    orbit_ctrl.enabled = true;
  }
}

function modelSelection(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  let intersects = raycaster.intersectObjects(models);
  console.log(intersects);
  if (intersects.length > 0 && intersects[0].object != selected_model) {
    selected_model = intersects[0].object;
    smooth_verts_undeformed.length = 0;
    for (let i = 0; i < smooth_geom.vertices.length; i++) {
      let copy_pt = new THREE.Vector3();
      copy_pt.copy(selected_model.geometry.vertices[i]);
      smooth_verts_undeformed.push(copy_pt);
    }
    rebuildFFD(false);
  }
}
function keyDown(event) {
  // esc
  if (event.keyCode == 27) {
    console.log("esc");
    removeCtrlPtMeshes();
    removeLatticeLines();
    trfm_ctrl.detach(trfm_ctrl.object);
    selected_model = null;
  }
}

function animate() {
  requestAnimationFrame(animate);
  orbit_ctrl.update();
  trfm_ctrl.update();
  render();
}

function render() {
  renderer.render(scene, camera);
}

function addModel() {
  loaderSTL.load("./jaw.stl", function (geometry) {
    orig_geom = geometry;
    // if (smooth_mesh) {
    //   scene.remove(group);
    //   scene.remove(smooth_mesh);
    // }
    let subd_modifier = new THREE.SubdivisionModifier(subd_level);
    smooth_geom = orig_geom.clone();
    smooth_geom.mergeVertices();
    smooth_geom.computeFaceNormals();
    smooth_geom.computeVertexNormals();
    subd_modifier.modify(smooth_geom);
    let smooth_materials = [
      new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0xe5e5e5,
        shininess: 1,
        side: THREE.DoubleSide,
      }),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        wireframe: true,
        opacity: 0.1,
        transparent: true,
      }),
    ];
    smooth_mesh = THREE.SceneUtils.createMultiMaterialObject(
      smooth_geom,
      smooth_materials
    );
    let temp_mesh = new THREE.Mesh(smooth_geom, smooth_materials[0]);
    model_scale = 1;
    smooth_mesh.scale.x = model_scale;
    smooth_mesh.scale.y = model_scale;
    smooth_mesh.scale.z = model_scale;
    models.push(temp_mesh);
    group.add(smooth_mesh);
  });
}

function rebuildFFD(span_count_change_only) {
  // removeCtrlPtMeshes();
  // removeLatticeLines();

  let bbox;
  if (span_count_change_only) {
    bbox = ffd.getBoundingBox();
  } else {
    bbox = new THREE.Box3();
    bbox.setFromPoints(smooth_geom.vertices);
    if (model_scale != 1)
      bbox.set(
        bbox.min.multiplyScalar(model_scale),
        bbox.max.multiplyScalar(model_scale)
      );
  }
  let span_counts_copy = [span_counts[0], span_counts[1], span_counts[2]];
  ffd.rebuildLattice(bbox, span_counts_copy);
  addCtrlPtMeshes();
  addLatticeLines();
  deform();
}

function removeCtrlPtMeshes() {
  for (let i = 0; i < ctrl_pt_meshes.length; i++)
    group.remove(ctrl_pt_meshes[i]);
  ctrl_pt_meshes.length = 0;
}

function removeLatticeLines() {
  for (let i = 0; i < lattice_lines.length; i++) group.remove(lattice_lines[i]);
  lattice_lines.length = 0;
}

function addCtrlPtMeshes() {
  for (let i = 0; i < ffd.getTotalCtrlPtCount(); i++) {
    let ctrl_pt_mesh = new THREE.Mesh(ctrl_pt_geom, ctrl_pt_material);
    ctrl_pt_mesh.position.copy(ffd.getPosition(i));
    ctrl_pt_mesh.material.ambient = ctrl_pt_mesh.material.color;
    ctrl_pt_meshes.push(ctrl_pt_mesh);
    group.add(ctrl_pt_mesh);
  }
}

function addLatticeLines() {
  for (let i = 0; i < ffd.getCtrlPtCount(0) - 1; i++) {
    for (let j = 0; j < ffd.getCtrlPtCount(1); j++) {
      for (let k = 0; k < ffd.getCtrlPtCount(2); k++) {
        let geometry = new THREE.Geometry();
        geometry.vertices.push(ctrl_pt_meshes[ffd.getIndex(i, j, k)].position);
        geometry.vertices.push(
          ctrl_pt_meshes[ffd.getIndex(i + 1, j, k)].position
        );
        let line = new THREE.Line(geometry, lattice_line_material);

        lattice_lines.push(line);
        group.add(line);
      }
    }
  }
  for (let i = 0; i < ffd.getCtrlPtCount(0); i++) {
    for (let j = 0; j < ffd.getCtrlPtCount(1) - 1; j++) {
      for (let k = 0; k < ffd.getCtrlPtCount(2); k++) {
        let geometry = new THREE.Geometry();
        geometry.vertices.push(ctrl_pt_meshes[ffd.getIndex(i, j, k)].position);
        geometry.vertices.push(
          ctrl_pt_meshes[ffd.getIndex(i, j + 1, k)].position
        );
        let line = new THREE.Line(geometry, lattice_line_material);

        lattice_lines.push(line);
        group.add(line);
      }
    }
  }
  for (let i = 0; i < ffd.getCtrlPtCount(0); i++) {
    for (let j = 0; j < ffd.getCtrlPtCount(1); j++) {
      for (let k = 0; k < ffd.getCtrlPtCount(2) - 1; k++) {
        let geometry = new THREE.Geometry();
        geometry.vertices.push(ctrl_pt_meshes[ffd.getIndex(i, j, k)].position);
        geometry.vertices.push(
          ctrl_pt_meshes[ffd.getIndex(i, j, k + 1)].position
        );
        let line = new THREE.Line(geometry, lattice_line_material);

        lattice_lines.push(line);
        group.add(line);
      }
    }
  }
}

// function createEvalPtsMesh() {
//   let total_eval_pts_count =
//     eval_pt_counts.x * eval_pt_counts.y * eval_pt_counts.z;
//   for (let i = 0; i < total_eval_pts_count; i++)
//     eval_pts_geom.vertices.push(new THREE.Vector3());
//   eval_pts_mesh = new THREE.Points(
//     eval_pts_geom.clone(),
//     new THREE.PointsMaterial({ color: 0xff0000, size: 2 })
//   );
//   group.add(eval_pts_mesh);
// }

function updateLattice() {
  for (let i = 0; i < ffd.getTotalCtrlPtCount(); i++)
    ffd.setPosition(i, ctrl_pt_meshes[i].position);
  let line_index = 0;
  for (let i = 0; i < ffd.getCtrlPtCount(0) - 1; i++) {
    for (let j = 0; j < ffd.getCtrlPtCount(1); j++) {
      for (let k = 0; k < ffd.getCtrlPtCount(2); k++) {
        let line = lattice_lines[line_index++];
        line.geometry.vertices[0] =
          ctrl_pt_meshes[ffd.getIndex(i, j, k)].position;
        line.geometry.vertices[1] =
          ctrl_pt_meshes[ffd.getIndex(i + 1, j, k)].position;
        line.geometry.verticesNeedUpdate = true;
      }
    }
  }
  for (let i = 0; i < ffd.getCtrlPtCount(0); i++) {
    for (let j = 0; j < ffd.getCtrlPtCount(1) - 1; j++) {
      for (let k = 0; k < ffd.getCtrlPtCount(2); k++) {
        let line = lattice_lines[line_index++];
        line.geometry.vertices[0] =
          ctrl_pt_meshes[ffd.getIndex(i, j, k)].position;
        line.geometry.vertices[1] =
          ctrl_pt_meshes[ffd.getIndex(i, j + 1, k)].position;
        line.geometry.verticesNeedUpdate = true;
      }
    }
  }
  for (let i = 0; i < ffd.getCtrlPtCount(0); i++) {
    for (let j = 0; j < ffd.getCtrlPtCount(1); j++) {
      for (let k = 0; k < ffd.getCtrlPtCount(2) - 1; k++) {
        let line = lattice_lines[line_index++];
        line.geometry.vertices[0] =
          ctrl_pt_meshes[ffd.getIndex(i, j, k)].position;
        line.geometry.vertices[1] =
          ctrl_pt_meshes[ffd.getIndex(i, j, k + 1)].position;
        line.geometry.verticesNeedUpdate = true;
      }
    }
  }
}

function deform() {
  for (let i = 0; i < smooth_geom.vertices.length; i++) {
    let eval_pt = ffd.evalWorld(smooth_verts_undeformed[i]);
    if (eval_pt.equals(smooth_geom.vertices[i])) continue;
    smooth_geom.vertices[i].copy(eval_pt);
  }
  smooth_geom.verticesNeedUpdate = true;
}
