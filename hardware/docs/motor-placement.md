# P3 motor placement and enclosure

The pan motor stays stationary, shaft vertical on the central axis. Its body is eccentric by the nominal 28BYJ shaft offset, while the sun and independent bearing-supported carrier remain coaxial. Fixed electronics sit horizontally around the actuator. Motor current is distributed directly to the two ULN2003 modules.

The tilt motor lies horizontally in the rear bridge of the U-frame, output toward +X. Its output face is X40 mm; the axis is Z121 mm with the belt-length-derived Y offset. A concealed 20T/40T belt connects to the camera axis at Z154.5. The belt plane is X58. Both side covers maintain the same external profile. Separate bearings, steel trunnions, spacers and a collar carry the load; the motor shaft supports the drive pulley only.

A true normal-offset curved bonnet encloses the electronics, actuator and two cable layers. Nominal section dimensions are 160×160 mm and height 89.5 mm; actual loft bounds are in the export manifest. This enlarged base is required by the proposed 20 mm USB return bend and accessible guide sections. The matte-black U-body remains the selected design language.

The four planets retain the requested compact coaxial actuator. A direct pan drive would use fewer parts, but would remove the requested planetary stage. The low rear tilt motor avoids a large external side pod and keeps its mass close to the pan axis. These decisions balance the owned motors, independent support, printing access and cable space; they do not establish globally optimal dimensions.

Review `p3-design-closure.md`, the sourced C200 data and the current generated reports before printing. The actual camera, connector and populated-board dimensions can still require a fit revision.
