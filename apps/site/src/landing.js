import './landing.css';
document.getElementById('load-viewer').addEventListener('click', () => {
  const frame = document.createElement('iframe');
  frame.title = 'Interactive CAMX Pro CAD assembly preview';
  frame.src = './viewer.html?embed=1';
  frame.setAttribute('allowfullscreen', '');
  document.getElementById('preview').replaceChildren(frame);
});
